"""Промокоды: генерация (админка) и применение. Правила — docs/09-billing-runs-promo.md."""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass

from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.ledger import credit
from app.core.db import aware, utcnow
from app.models import PromoCode, PromoRedemption, User

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # без 0/O, 1/I/L


def generate_code(groups: int = 2, size: int = 4) -> str:
    return "-".join("".join(secrets.choice(ALPHABET) for _ in range(size)) for _ in range(groups))


def normalize_code(code: str) -> str:
    return code.strip().upper().replace(" ", "")


class PromoError(Exception):
    """reason — для логов; пользователю всегда одно сообщение «Код не найден или недоступен»."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass
class RedeemResult:
    kind: str
    value: int
    granted_runs: int
    redemption_id: int


async def redeem(s: AsyncSession, user: User, raw_code: str) -> RedeemResult:
    code = normalize_code(raw_code)
    promo = (await s.execute(select(PromoCode).where(PromoCode.code == code))).scalar_one_or_none()
    now = utcnow()
    if promo is None:
        raise PromoError("not_found")
    if promo.disabled_at:
        raise PromoError("disabled")
    if promo.valid_from and aware(promo.valid_from) > now:
        raise PromoError("not_started")
    if promo.valid_until and aware(promo.valid_until) < now:
        raise PromoError("expired")
    if promo.scope == "personal" and promo.user_id != user.id:
        raise PromoError("not_owner")
    exists = (await s.execute(select(PromoRedemption.id).where(
        PromoRedemption.promo_code_id == promo.id, PromoRedemption.user_id == user.id))).first()
    if exists:
        raise PromoError("already_used")
    # Атомарно занимаем «место» в общем лимите.
    took = (await s.execute(
        update(PromoCode).where(
            PromoCode.id == promo.id,
            or_(PromoCode.max_redemptions.is_(None), PromoCode.redemptions < PromoCode.max_redemptions),
        ).values(redemptions=PromoCode.redemptions + 1).returning(PromoCode.id)
    )).first()
    if took is None:
        raise PromoError("exhausted")
    red = PromoRedemption(promo_code_id=promo.id, user_id=user.id, applied=promo.kind == "runs")
    s.add(red)
    try:
        await s.flush()
    except IntegrityError as e:
        raise PromoError("already_used") from e
    granted = 0
    if promo.kind == "runs":
        await credit(s, user.id, promo.value, "promo", promo_redemption_id=red.id, note=promo.code[:4] + "…")
        granted = promo.value
    return RedeemResult(kind=promo.kind, value=promo.value, granted_runs=granted, redemption_id=red.id)


async def pending_discount(s: AsyncSession, user_id: uuid.UUID) -> tuple[PromoRedemption, PromoCode] | None:
    row = (await s.execute(
        select(PromoRedemption, PromoCode).join(PromoCode, PromoCode.id == PromoRedemption.promo_code_id)
        .where(PromoRedemption.user_id == user_id, PromoRedemption.applied.is_(False))
        .order_by(PromoRedemption.id.desc())
    )).first()
    return (row[0], row[1]) if row else None


def apply_discount(price_rub: int, promo: PromoCode | None) -> int:
    if promo is None:
        return price_rub
    if promo.kind == "discount_percent":
        return max(1, round(price_rub * (100 - min(promo.value, 99)) / 100))
    if promo.kind == "fixed_price":
        return max(1, promo.value // 100)
    return price_rub
