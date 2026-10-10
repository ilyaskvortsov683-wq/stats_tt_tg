"""Админка: статистика, пользователи, промокоды, разборы, журнал событий. Описание — docs/15-admin.md."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.ledger import balance, credit
from app.billing.promo import generate_code, normalize_code
from app.core.db import get_session, utcnow
from app.core.security import admin_user, require_csrf
from app.events import emit
from app.models import AdminAudit, Event, LedgerEntry, Payment, PromoCode, PromoRedemption, Run, User

router = APIRouter(prefix="/admin")


@router.get("/stats")
async def stats(days: int = 30, admin: User = Depends(admin_user), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    since = utcnow() - timedelta(days=days)

    async def count(model, *where) -> int:
        return (await s.execute(select(func.count()).select_from(model).where(*where))).scalar_one()

    revenue_rub = (await s.execute(select(func.coalesce(func.sum(Payment.amount_minor), 0)).where(
        Payment.status == "succeeded", Payment.currency == "RUB", Payment.created_at >= since))).scalar_one()
    revenue_xtr = (await s.execute(select(func.coalesce(func.sum(Payment.amount_minor), 0)).where(
        Payment.status == "succeeded", Payment.currency == "XTR", Payment.created_at >= since))).scalar_one()
    sections: dict[str, int] = {}
    for (secs,) in (await s.execute(select(Run.sections).where(Run.created_at >= since))).all():
        for x in secs or []:
            sections[x] = sections.get(x, 0) + 1
    return {
        "period_days": days,
        "users_total": await count(User, User.deleted_at.is_(None)),
        "users_new": await count(User, User.created_at >= since),
        "users_active": await count(User, User.last_seen_at >= since),
        "uploads": await count(Event, Event.type == "upload.parsed", Event.ts >= since),
        "free_analyses": await count(Event, Event.type == "analysis.free_computed", Event.ts >= since),
        "runs_paid": await count(Run, Run.charge == "paid", Run.status == "done", Run.created_at >= since),
        "runs_rerun": await count(Run, Run.charge == "free_rerun", Run.created_at >= since),
        "runs_admin": await count(Run, Run.charge == "admin", Run.created_at >= since),
        "runs_failed": await count(Run, Run.status == "failed", Run.created_at >= since),
        "payments": await count(Payment, Payment.status == "succeeded", Payment.created_at >= since),
        "revenue_rub": revenue_rub / 100,
        "revenue_stars": revenue_xtr,
        "promo_redemptions": await count(PromoRedemption, PromoRedemption.created_at >= since),
        "errors_24h": await count(Event, Event.level == "error", Event.ts >= utcnow() - timedelta(hours=24)),
        "sections_popularity": sorted(sections.items(), key=lambda x: -x[1]),
    }


@router.get("/users")
async def users(q: str = "", admin: User = Depends(admin_user), s: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    stmt = select(User).order_by(User.created_at.desc()).limit(100)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(User.email).like(like), User.user_ref.like(like)))
    rows = (await s.execute(stmt)).scalars().all()
    return [{"id": str(u.id), "user_ref": u.user_ref, "email": u.email, "role": u.role,
             "created_at": u.created_at.isoformat(), "last_seen_at": u.last_seen_at.isoformat() if u.last_seen_at else None,
             "balance": await balance(s, u.id)} for u in rows]


@router.get("/users/{user_id}")
async def user_card(user_id: uuid.UUID, admin: User = Depends(admin_user), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    u = await s.get(User, user_id)
    if not u:
        raise HTTPException(404)
    ledger = (await s.execute(select(LedgerEntry).where(LedgerEntry.user_id == u.id).order_by(LedgerEntry.id.desc()).limit(100))).scalars().all()
    runs = (await s.execute(select(Run).where(Run.user_id == u.id).order_by(Run.created_at.desc()).limit(50))).scalars().all()
    pays = (await s.execute(select(Payment).where(Payment.user_id == u.id).order_by(Payment.created_at.desc()).limit(50))).scalars().all()
    events = (await s.execute(select(Event).where(Event.user_ref == u.user_ref).order_by(Event.id.desc()).limit(100))).scalars().all()
    return {
        "user": {"id": str(u.id), "user_ref": u.user_ref, "email": u.email, "role": u.role, "tz": u.tz, "city": u.city,
                 "created_at": u.created_at.isoformat()},
        "balance": await balance(s, u.id),
        "ledger": [{"delta": x.delta, "reason": x.reason, "at": x.created_at.isoformat(), "note": x.note} for x in ledger],
        "runs": [{"id": str(r.id), "source": r.source, "status": r.status, "charge": r.charge, "sections": r.sections,
                  "at": r.created_at.isoformat(), "error": r.error_code} for r in runs],
        "payments": [{"id": str(p.id), "provider": p.provider, "amount": p.amount_minor, "currency": p.currency,
                      "status": p.status, "at": p.created_at.isoformat()} for p in pays],
        "events": [{"ts": e.ts.isoformat(), "level": e.level, "type": e.type, "data": e.data} for e in events],
    }


class GrantIn(BaseModel):
    runs: int = Field(ge=-100, le=100)
    reason: str = Field(min_length=2, max_length=200)


@router.post("/users/{user_id}/grant", dependencies=[Depends(require_csrf)])
async def grant(user_id: uuid.UUID, body: GrantIn, admin: User = Depends(admin_user),
                s: AsyncSession = Depends(get_session)) -> dict[str, int]:
    u = await s.get(User, user_id)
    if not u:
        raise HTTPException(404)
    new_balance = await credit(s, u.id, body.runs, "admin_grant", note=body.reason)
    s.add(AdminAudit(admin_id=admin.id, action="grant", target=u.user_ref, data=body.model_dump()))
    await emit(s, "admin.grant", user_ref=u.user_ref, runs=body.runs)
    await s.commit()
    return {"balance": new_balance}


class PromoIn(BaseModel):
    kind: str = Field(pattern="^(runs|discount_percent|fixed_price)$")
    value: int = Field(ge=1, le=1_000_000)
    scope: str = Field(pattern="^(personal|global)$")
    user_email: str | None = None
    max_redemptions: int | None = Field(default=None, ge=1)
    valid_until: datetime | None = None
    code: str | None = Field(default=None, max_length=40)
    count: int = Field(default=1, ge=1, le=500)
    note: str | None = Field(default=None, max_length=300)


@router.get("/promos")
async def list_promos(admin: User = Depends(admin_user), s: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    rows = (await s.execute(select(PromoCode).order_by(PromoCode.id.desc()).limit(500))).scalars().all()
    return [{"id": p.id, "code": p.code, "kind": p.kind, "value": p.value, "scope": p.scope,
             "user_id": str(p.user_id) if p.user_id else None, "redemptions": p.redemptions,
             "max_redemptions": p.max_redemptions, "valid_until": p.valid_until.isoformat() if p.valid_until else None,
             "disabled": bool(p.disabled_at), "note": p.note, "created_at": p.created_at.isoformat()} for p in rows]


@router.post("/promos", dependencies=[Depends(require_csrf)])
async def create_promos(body: PromoIn, admin: User = Depends(admin_user), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    target_id = None
    if body.scope == "personal":
        if not body.user_email:
            raise HTTPException(422, "personal_promo_needs_user")
        target = (await s.execute(select(User).where(User.email == body.user_email.strip().lower()))).scalar_one_or_none()
        if not target:
            raise HTTPException(404, "user_not_found")
        target_id = target.id
    codes = []
    for _ in range(body.count):
        code = normalize_code(body.code) if body.code and body.count == 1 else generate_code()
        if (await s.execute(select(PromoCode.id).where(PromoCode.code == code))).first():
            if body.code:
                raise HTTPException(409, "code_exists")
            code = generate_code(3)
        s.add(PromoCode(code=code, kind=body.kind, value=body.value, scope=body.scope, user_id=target_id,
                        max_redemptions=body.max_redemptions, valid_until=body.valid_until, note=body.note,
                        created_by=admin.id))
        codes.append(code)
    s.add(AdminAudit(admin_id=admin.id, action="promo.create", target=None,
                     data={"count": len(codes), "kind": body.kind, "value": body.value, "scope": body.scope}))
    await emit(s, "promo.created", count=len(codes), kind=body.kind, scope=body.scope)
    await s.commit()
    return {"codes": codes}


@router.patch("/promos/{promo_id}", dependencies=[Depends(require_csrf)])
async def disable_promo(promo_id: int, admin: User = Depends(admin_user), s: AsyncSession = Depends(get_session)) -> dict[str, bool]:
    p = await s.get(PromoCode, promo_id)
    if not p:
        raise HTTPException(404)
    p.disabled_at = None if p.disabled_at else utcnow()
    s.add(AdminAudit(admin_id=admin.id, action="promo.toggle", target=p.code[:4] + "…", data={"disabled": bool(p.disabled_at)}))
    await s.commit()
    return {"disabled": bool(p.disabled_at)}


@router.get("/runs")
async def runs(status: str | None = None, admin: User = Depends(admin_user), s: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    stmt = select(Run, User.user_ref).join(User, User.id == Run.user_id).order_by(Run.created_at.desc()).limit(200)
    if status:
        stmt = stmt.where(Run.status == status)
    return [{"id": str(r.id), "user_ref": ref, "source": r.source, "status": r.status, "charge": r.charge,
             "sections": r.sections, "error": r.error_code, "timings": r.timings, "at": r.created_at.isoformat()}
            for r, ref in (await s.execute(stmt)).all()]


@router.get("/events")
async def events(level: str | None = None, type: str | None = None, user_ref: str | None = None, limit: int = 200,
                 admin: User = Depends(admin_user), s: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    stmt = select(Event).order_by(Event.id.desc()).limit(min(limit, 1000))
    if level:
        stmt = stmt.where(Event.level == level)
    if type:
        stmt = stmt.where(Event.type.like(type.replace("*", "%")))
    if user_ref:
        stmt = stmt.where(Event.user_ref == user_ref)
    return [{"id": e.id, "ts": e.ts.isoformat(), "level": e.level, "type": e.type, "user_ref": e.user_ref,
             "run_id": str(e.run_id) if e.run_id else None, "request_id": e.request_id, "source": e.source, "data": e.data}
            for e in (await s.execute(stmt)).scalars().all()]
