"""Журнал разборов. Баланс меняется ТОЛЬКО здесь и всегда вместе с записью в ledger. Правила — docs/09."""

from __future__ import annotations

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LedgerEntry, Wallet


async def balance(s: AsyncSession, user_id: uuid.UUID) -> int:
    w = await s.get(Wallet, user_id)
    return w.balance if w else 0


async def _ensure_wallet(s: AsyncSession, user_id: uuid.UUID) -> None:
    if await s.get(Wallet, user_id) is None:
        s.add(Wallet(user_id=user_id, balance=0))
        await s.flush()


async def credit(s: AsyncSession, user_id: uuid.UUID, delta: int, reason: str, *, payment_id=None,
                 promo_redemption_id=None, run_id=None, note: str | None = None) -> int:
    """Начисление (delta > 0) или списание без проверки (возврат платежа). Вызывать внутри транзакции."""
    await _ensure_wallet(s, user_id)
    new_balance = (await s.execute(
        update(Wallet).where(Wallet.user_id == user_id).values(balance=Wallet.balance + delta).returning(Wallet.balance)
    )).scalar_one()
    s.add(LedgerEntry(user_id=user_id, delta=delta, reason=reason, payment_id=payment_id,
                      promo_redemption_id=promo_redemption_id, run_id=run_id, note=note))
    return new_balance


async def try_reserve(s: AsyncSession, user_id: uuid.UUID, run_id: uuid.UUID) -> bool:
    """Атомарное списание одного разбора: UPDATE ... WHERE balance >= 1. Параллельные запросы не спишут дважды."""
    await _ensure_wallet(s, user_id)
    row = (await s.execute(
        update(Wallet).where(Wallet.user_id == user_id, Wallet.balance >= 1)
        .values(balance=Wallet.balance - 1).returning(Wallet.balance)
    )).first()
    if row is None:
        return False
    s.add(LedgerEntry(user_id=user_id, delta=-1, reason="run_reserve", run_id=run_id))
    return True


async def release(s: AsyncSession, user_id: uuid.UUID, run_id: uuid.UUID) -> None:
    """Вернуть разбор, если отчёт не построился. Идемпотентно."""
    already = (await s.execute(
        select(LedgerEntry.id).where(LedgerEntry.run_id == run_id, LedgerEntry.reason == "run_release")
    )).first()
    reserved = (await s.execute(
        select(LedgerEntry.id).where(LedgerEntry.run_id == run_id, LedgerEntry.reason == "run_reserve")
    )).first()
    if reserved and not already:
        await credit(s, user_id, 1, "run_release", run_id=run_id)
