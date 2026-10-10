"""Мелкие эндпоинты: каталог сводок, гайды экспорта, клиентские логи, события браузера."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings, tiers_config
from app.core.db import get_session
from app.core.security import current_user_optional
from app.events import emit
from app.models import User

router = APIRouter()


@router.get("/catalog")
async def catalog() -> dict[str, Any]:
    return tiers_config()


@router.get("/guides/{source}")
async def guide(source: str) -> dict[str, Any]:
    name = {"tg": "export-telegram.md", "tt": "export-tiktok.md"}.get(source)
    if not name:
        raise HTTPException(404)
    text = (Path(settings.guides_dir) / name).read_text(encoding="utf-8")
    return {"markdown": text}


class ClientEvent(BaseModel):
    type: str = Field(pattern=r"^(upload\.(started|parsed|failed)|analysis\.free_computed|sections\.selected|client\.(error|perf)|visit\.(landing|app)|parser\.unknown_shape)$")
    data: dict[str, Any] = Field(default_factory=dict)


class ClientBatch(BaseModel):
    events: list[ClientEvent] = Field(max_length=50)


@router.post("/logs/client")
async def client_logs(batch: ClientBatch, request: Request, user: User | None = Depends(current_user_optional),
                      s: AsyncSession = Depends(get_session)) -> dict[str, int]:
    """События браузера. Тексты и имена сюда не отправляются (см. privacy-guard); scrub всё равно применяется."""
    reserved = {"level", "user_ref", "run_id", "request_id", "source", "type_"}
    for e in batch.events:
        level = "error" if e.type == "client.error" else "warning" if e.type == "upload.failed" else "info"
        data = {("data_" + k if k in reserved else k): v for k, v in list(e.data.items())[:20]}
        await emit(s, e.type, level=level, user_ref=user.user_ref if user else None, source="web",
                   request_id=request.state.request_id, **data)
    await s.commit()
    return {"accepted": len(batch.events)}
