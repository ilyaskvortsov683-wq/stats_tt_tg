"""Разборы: резерв → пакет → расчёт → отчёт. Поток — docs/02-architecture.md §2.2."""

from __future__ import annotations

import gzip
import io
import json
import time
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.ledger import balance, release, try_reserve
from app.core.config import is_free_section, products_config, section_info, settings
from app.core.db import SessionLocal, aware, get_session, utcnow
from app.core.security import chat_fingerprint, current_user, require_csrf
from app.dictionaries.service import active_raw, build_client_dictionaries
from app.events import emit
from app.integrations.sheets import enqueue
from app.metrics.packet import PacketV1
from app.metrics.report_model import build_report_model
from app.models import Run, User
from app.report.render import render_report
from app.report.sample import sample_html
from app.tiktok.history import load_views

router = APIRouter()

MAX_COMPRESSED = 5 * 1024 * 1024
MAX_RAW = 50 * 1024 * 1024
DICT_SECTIONS = {"tg.words", "tg.laugh_swear", "tg.names"}


class RunIn(BaseModel):
    source: str = Field(pattern="^(tg|tt)$")
    chat_kind: str = Field(pattern="^(personal|group|account)$")
    chat_key: str = Field(min_length=1, max_length=300)
    sections: list[str] = Field(min_length=1, max_length=30)
    custom_names: list[str] = Field(default_factory=list, max_length=20)


@router.post("/runs", dependencies=[Depends(require_csrf)])
async def create_run(body: RunIn, request: Request, user: User = Depends(current_user),
                     s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    unknown = [x for x in body.sections if not section_info(x) or not x.startswith(body.source + ".")]
    if unknown:
        raise HTTPException(422, "unknown_sections")
    paid = [x for x in body.sections if not is_free_section(x)]
    if not paid:
        raise HTTPException(400, "free_sections_are_computed_in_browser")
    fp = chat_fingerprint(user.id, body.source, body.chat_key)
    run = Run(user_id=user.id, source=body.source, chat_kind=body.chat_kind, chat_fingerprint=fp,
              sections=body.sections, charge="paid")
    s.add(run)
    await s.flush()
    days = int(products_config()["rerun_free_days"])
    recent = (await s.execute(select(Run.id).where(
        Run.user_id == user.id, Run.chat_fingerprint == fp, Run.status == "done", Run.charge.in_(("paid", "admin")),
        Run.created_at > utcnow() - timedelta(days=days)))).first()
    if user.role == "admin":
        run.charge = "admin"
    elif recent:
        run.charge = "free_rerun"
    elif not await try_reserve(s, user.id, run.id):
        await s.rollback()
        raise HTTPException(402, "no_runs_left")
    dictionaries = None
    if DICT_SECTIONS & set(body.sections):
        dictionaries = build_client_dictionaries(active_raw(), custom_names=body.custom_names)
    await emit(s, "run.reserved", user_ref=user.user_ref, run_id=run.id, chat_source=body.source, charge=run.charge,
               sections=body.sections, request_id=request.state.request_id)
    await s.commit()
    return {"run_id": str(run.id), "charge": run.charge, "balance": await balance(s, user.id),
            "dictionaries": dictionaries}


async def _read_body(request: Request) -> bytes:
    raw = await request.body()
    if len(raw) > MAX_COMPRESSED:
        raise HTTPException(413, "packet_too_large")
    if request.headers.get("content-encoding") == "gzip" or raw[:2] == b"\x1f\x8b":
        d = gzip.GzipFile(fileobj=io.BytesIO(raw))
        out = d.read(MAX_RAW + 1)
        if len(out) > MAX_RAW:
            raise HTTPException(413, "packet_too_large")
        return out
    return raw


@router.post("/runs/{run_id}/packet", status_code=202, dependencies=[Depends(require_csrf)])
async def upload_packet(run_id: uuid.UUID, request: Request, background: BackgroundTasks,
                        user: User = Depends(current_user), s: AsyncSession = Depends(get_session)) -> dict[str, str]:
    run = await s.get(Run, run_id)
    if not run or run.user_id != user.id:
        raise HTTPException(404)
    if run.status != "reserved":
        raise HTTPException(409, "packet_already_received")
    body = await _read_body(request)
    try:
        packet = PacketV1.model_validate(json.loads(body))
    except (ValueError, ValidationError) as e:
        run.status = "failed"
        run.error_code = "packet_invalid"
        await release(s, user.id, run.id)
        await emit(s, "packet.invalid", level="warning", user_ref=user.user_ref, run_id=run.id,
                   reason=str(e)[:300])
        await s.commit()
        raise HTTPException(422, "packet_invalid") from e
    if set(packet.sections) - set(run.sections) or packet.source != run.source:
        raise HTTPException(422, "sections_mismatch")
    run.status = "queued"
    run.packet_bytes = len(body)
    run.title = packet.title[:200]
    await emit(s, "run.packet_received", user_ref=user.user_ref, run_id=run.id, bytes=len(body))
    await s.commit()
    # v1: считаем в фоне процесса API. Фаза 6: перенести в очередь arq (worker).
    background.add_task(process_run, run.id, packet)
    return {"status": "queued"}


async def process_run(run_id: uuid.UUID, packet: PacketV1) -> None:
    async with SessionLocal() as s:
        run = await s.get(Run, run_id)
        user = await s.get(User, run.user_id) if run else None
        if not run or not user:
            return
        user_ref, user_id = user.user_ref, user.id  # после rollback ORM-объекты «протухают»
        t0 = time.monotonic()
        try:
            run.status = "computing"
            await s.commit()
            views = None
            if packet.source == "tt" and packet.tt and packet.tt.use_history:
                views = [t for t, _ in await load_views(s, user.id)]
            model = build_report_model(packet, views_override=views)
            t1 = time.monotonic()
            run.status = "rendering"
            html = render_report(model)
            path = Path(settings.reports_dir) / f"{run.id}.html"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(html, encoding="utf-8")
            run.report_path = str(path)
            run.status = "done"
            run.finished_at = utcnow()
            run.timings = {"compute_ms": int((t1 - t0) * 1000), "render_ms": int((time.monotonic() - t1) * 1000)}
            await emit(s, "run.done", user_ref=user.user_ref, run_id=run.id, charge=run.charge, **run.timings)
        except Exception as e:  # noqa: BLE001 — любая ошибка возвращает разбор
            await s.rollback()
            run = await s.get(Run, run_id)
            run.status = "failed"
            run.error_code = type(e).__name__
            await release(s, user_id, run.id)
            await emit(s, "run.failed", level="error", user_ref=user_ref, run_id=run.id, error=type(e).__name__)
        secs = round((utcnow() - aware(run.created_at)).total_seconds(), 1) if run.created_at else ""
        await enqueue(s, "runs", [utcnow().strftime("%Y-%m-%d %H:%M:%S"), user_ref, run.source, run.chat_kind,
                                  ",".join(run.sections), run.charge, run.status, secs, round((run.packet_bytes or 0) / 1024)])
        await s.commit()


@router.get("/runs")
async def my_runs(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    rows = (await s.execute(select(Run).where(Run.user_id == user.id, Run.deleted_at.is_(None))
                            .order_by(Run.created_at.desc()).limit(100))).scalars().all()
    return [_run_out(r) for r in rows]


def _run_out(r: Run) -> dict[str, Any]:
    return {"id": str(r.id), "source": r.source, "chat_kind": r.chat_kind, "title": r.title, "sections": r.sections,
            "status": r.status, "charge": r.charge, "error_code": r.error_code, "created_at": r.created_at.isoformat()}


@router.get("/runs/{run_id}")
async def run_status(run_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    run = await s.get(Run, run_id)
    if not run or run.user_id != user.id:
        raise HTTPException(404)
    return _run_out(run)


@router.get("/runs/{run_id}/report.html")
async def run_report(run_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    run = await s.get(Run, run_id)
    if not run or run.user_id != user.id or run.status != "done" or not run.report_path or run.deleted_at:
        raise HTTPException(404)
    return FileResponse(run.report_path, media_type="text/html; charset=utf-8",
                        headers={"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; img-src data:"})


@router.post("/runs/{run_id}/export", dependencies=[Depends(require_csrf)])
async def export_run(run_id: uuid.UUID) -> dict[str, str]:
    raise HTTPException(501, "export_pdf_png_in_phase_7")


@router.delete("/runs/{run_id}", dependencies=[Depends(require_csrf)])
async def delete_run(run_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)) -> dict[str, bool]:
    run = await s.get(Run, run_id)
    if not run or run.user_id != user.id:
        raise HTTPException(404)
    if run.report_path:
        Path(run.report_path).unlink(missing_ok=True)
    run.deleted_at = utcnow()
    await s.commit()
    return {"ok": True}


@router.get("/sample/{source}", response_class=HTMLResponse)
async def sample_report(source: str) -> HTMLResponse:
    if source not in ("tg", "tt"):
        raise HTTPException(404)
    return HTMLResponse(sample_html(source))
