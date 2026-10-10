"""Продукты, оплата (ЮKassa), промокоды, журнал разборов."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.ledger import balance, credit
from app.billing.promo import PromoError, apply_discount, pending_discount, redeem
from app.billing.yookassa import YooKassaClient, YooKassaError, is_yookassa_ip
from app.core.config import products_config, settings
from app.core.db import get_session, utcnow
from app.core.security import current_user, require_csrf
from app.events import emit
from app.integrations.sheets import enqueue
from app.models import LedgerEntry, Payment, PromoCode, User

router = APIRouter()


def product_by_id(product_id: str) -> dict[str, Any]:
    for p in products_config()["products"]:
        if p["id"] == product_id and p.get("active", True):
            return p
    raise HTTPException(404, "product_not_found")


@router.get("/products")
async def products() -> dict[str, Any]:
    cfg = products_config()
    return {
        "unit_name": cfg["unit_name"],
        "rerun_free_days": cfg["rerun_free_days"],
        "products": [p for p in cfg["products"] if p.get("active", True)],
    }


@router.get("/me/ledger")
async def my_ledger(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    rows = (await s.execute(
        select(LedgerEntry).where(LedgerEntry.user_id == user.id).order_by(LedgerEntry.id.desc()).limit(200)
    )).scalars().all()
    return {
        "balance": await balance(s, user.id),
        "items": [{"delta": r.delta, "reason": r.reason, "at": r.created_at.isoformat(), "note": r.note} for r in rows],
    }


class RedeemIn(BaseModel):
    code: str


@router.post("/promo/redeem", dependencies=[Depends(require_csrf)])
async def promo_redeem(body: RedeemIn, request: Request, user: User = Depends(current_user),
                       s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    user_ref = user.user_ref  # после rollback объект пользователя «протухает»
    try:
        result = await redeem(s, user, body.code)
    except PromoError as e:
        await s.rollback()
        await emit(s, "promo.redeem_failed", level="warning", user_ref=user_ref, reason=e.reason,
                   request_id=request.state.request_id)
        await s.commit()
        raise HTTPException(400, "promo_unavailable") from e
    await emit(s, "promo.redeemed", user_ref=user.user_ref, kind=result.kind, value=result.value,
               request_id=request.state.request_id)
    await enqueue(s, "orders", [utcnow().strftime("%Y-%m-%d %H:%M:%S"), user.user_ref, "promo", "promo", result.kind,
                                result.granted_runs, 0, 0, body.code.strip().upper()[:4] + "…", "ok"])
    await s.commit()
    return {"kind": result.kind, "value": result.value, "granted_runs": result.granted_runs,
            "balance": await balance(s, user.id)}


class PaymentIn(BaseModel):
    product_id: str


@router.post("/payments/yookassa", dependencies=[Depends(require_csrf)])
async def create_yookassa_payment(body: PaymentIn, request: Request, user: User = Depends(current_user),
                                  s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    product = product_by_id(body.product_id)
    disc = await pending_discount(s, user.id)
    price = apply_discount(int(product["price_rub"]), disc[1] if disc else None)
    payment = Payment(user_id=user.id, provider="yookassa", product_id=product["id"], amount_minor=price * 100,
                      currency="RUB", runs=int(product["runs"]), promo_redemption_id=disc[0].id if disc else None)
    s.add(payment)
    await s.flush()
    client = YooKassaClient()
    if not client.configured:
        if not settings.is_local:
            raise HTTPException(503, "payments_not_configured")
        # Локальная заглушка: «оплата» подтверждается кнопкой на странице оплаты.
        payment.provider = "mock"
        payment.provider_payment_id = "mock-" + str(payment.id)
        await s.commit()
        return {"confirmation_url": f"{settings.public_url}/app/billing?mock_payment={payment.id}", "mock": True}
    try:
        yk = await client.create_payment(
            amount_rub=price, description=f"{product['title']} — аналитика переписок",
            return_url=f"{settings.public_url}/app/billing?paid=1",
            metadata={"payment_id": str(payment.id), "user_ref": user.user_ref, "product_id": product["id"]},
            idempotence_key=str(payment.id),
        )
    except YooKassaError as e:
        await emit(s, "payment.create_failed", level="error", user_ref=user.user_ref, error=str(e)[:200])
        await s.commit()
        raise HTTPException(502, "payment_provider_error") from e
    payment.provider_payment_id = yk["id"]
    payment.raw = {"status": yk.get("status")}
    await emit(s, "payment.created", user_ref=user.user_ref, product=product["id"], amount=price,
               request_id=request.state.request_id)
    await s.commit()
    return {"confirmation_url": yk["confirmation"]["confirmation_url"]}


async def mark_succeeded(s: AsyncSession, payment: Payment, method: str) -> bool:
    """Идемпотентное начисление: повторный вызов ничего не меняет."""
    if payment.status == "succeeded":
        return False
    payment.status = "succeeded"
    await credit(s, payment.user_id, payment.runs, "purchase", payment_id=payment.id)
    if payment.promo_redemption_id:
        from app.models import PromoRedemption

        red = await s.get(PromoRedemption, payment.promo_redemption_id)
        if red:
            red.applied = True
            red.payment_id = payment.id
    user = await s.get(User, payment.user_id)
    promo_mask = ""
    if payment.promo_redemption_id:
        from app.models import PromoRedemption

        red = await s.get(PromoRedemption, payment.promo_redemption_id)
        promo = await s.get(PromoCode, red.promo_code_id) if red else None
        promo_mask = promo.code[:4] + "…" if promo else ""
    rub = payment.amount_minor / 100 if payment.currency == "RUB" else 0
    xtr = payment.amount_minor if payment.currency == "XTR" else 0
    await emit(s, "payment.succeeded" if method != "stars" else "stars.paid", user_ref=user.user_ref if user else None,
               product=payment.product_id, rub=rub, stars=xtr, runs=payment.runs)
    await enqueue(s, "orders", [utcnow().strftime("%Y-%m-%d %H:%M:%S"), user.user_ref if user else "", "payment", method,
                                payment.product_id, payment.runs, rub, xtr, promo_mask, "succeeded"])
    return True


@router.post("/webhooks/yookassa")
async def yookassa_webhook(request: Request, s: AsyncSession = Depends(get_session)) -> dict[str, str]:
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    if settings.yookassa_check_ip and not settings.is_local and not is_yookassa_ip(ip):
        await emit(s, "payment.webhook_rejected", level="warning", reason="ip")
        await s.commit()
        raise HTTPException(403, "forbidden")
    body = await request.json()
    obj = body.get("object") or {}
    provider_id = obj.get("id")
    if not provider_id:
        return {"status": "ignored"}
    # Не доверяем телу уведомления: перезапрашиваем платёж у ЮKassa.
    fresh = await YooKassaClient().get_payment(provider_id)
    payment = (await s.execute(
        select(Payment).where(Payment.provider == "yookassa", Payment.provider_payment_id == provider_id)
    )).scalar_one_or_none()
    if payment is None:
        await emit(s, "payment.webhook_unknown", level="warning")
        await s.commit()
        return {"status": "unknown"}
    expected = f"{payment.amount_minor / 100:.2f}"
    if fresh.get("status") == "succeeded" and fresh.get("amount", {}).get("value") == expected:
        await mark_succeeded(s, payment, "yookassa")
    elif fresh.get("status") == "canceled":
        payment.status = "canceled"
        await emit(s, "payment.canceled", user_ref=None)
    try:
        await s.commit()
    except IntegrityError:
        await s.rollback()
    return {"status": "ok"}


@router.post("/payments/mock/{payment_id}/succeed", dependencies=[Depends(require_csrf)])
async def mock_succeed(payment_id: uuid.UUID, user: User = Depends(current_user),
                       s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Только локально: имитация успешной оплаты."""
    if not settings.is_local:
        raise HTTPException(404)
    payment = await s.get(Payment, payment_id)
    if not payment or payment.user_id != user.id or payment.provider != "mock":
        raise HTTPException(404)
    await mark_succeeded(s, payment, "mock")
    await s.commit()
    return {"balance": await balance(s, user.id)}
