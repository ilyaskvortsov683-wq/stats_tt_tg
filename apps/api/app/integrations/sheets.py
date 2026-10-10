"""Зеркало данных в Google Sheets — «удобная база» для автора. Источник истины — PostgreSQL.

Листы: users, orders, runs, events, errors, daily (формулы). Структура — docs/16-google-integrations.md.
Запись идёт через таблицу sheets_outbox пачками раз в минуту (воркер), чтобы не упираться в квоты API.
Лист users перезаписывается целиком снимком раз в 10 минут.
Email в таблицу НЕ пишется (152-ФЗ): только user_ref, по нему человек находится в админке.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import utcnow
from app.models import LedgerEntry, Payment, Run, SheetsOutbox, User, Wallet

log = structlog.get_logger()

HEADERS: dict[str, list[str]] = {
    "orders": ["Время (UTC)", "Пользователь", "Тип", "Способ", "Продукт", "Разборов", "Сумма ₽", "Сумма ⭐", "Промокод", "Статус"],
    "runs": ["Время (UTC)", "Пользователь", "Источник", "Тип чата", "Сводки", "Списание", "Статус", "Секунд", "Пакет, КБ"],
    "events": ["Время (UTC)", "Уровень", "Событие", "Пользователь", "Разбор", "Данные"],
    "errors": ["Время (UTC)", "Событие", "Пользователь", "Разбор", "Данные"],
    "users": ["Пользователь", "Роль", "Создан", "Последний визит", "Telegram", "Баланс разборов", "Куплено разборов",
              "Оплачено ₽", "Оплачено ⭐", "Разборов сделано", "Последний разбор"],
}


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")


async def enqueue(s: AsyncSession, sheet: str, row: list[Any]) -> None:
    s.add(SheetsOutbox(sheet=sheet, row=row))


async def enqueue_event(s: AsyncSession, type_: str, level: str, user_ref: str | None, run_id: uuid.UUID | None,
                        data: dict[str, Any]) -> None:
    row = [_now(), level, type_, user_ref or "", str(run_id or ""), json.dumps(data, ensure_ascii=False)[:500]]
    await enqueue(s, "events", row)
    if level == "error":
        await enqueue(s, "errors", [row[0], type_, user_ref or "", str(run_id or ""), row[5]])


def _service():
    """Клиент Sheets API через сервисный аккаунт. None — если не настроено (локальная разработка)."""
    if not settings.google_sa_json or not settings.ops_sheet_id:
        return None
    from google.oauth2 import service_account  # type: ignore
    from googleapiclient.discovery import build  # type: ignore

    info = json.loads(settings.google_sa_json)
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


async def flush_outbox(s: AsyncSession, limit: int = 500) -> int:
    rows = (await s.execute(
        select(SheetsOutbox).where(SheetsOutbox.sent_at.is_(None)).order_by(SheetsOutbox.id).limit(limit)
    )).scalars().all()
    if not rows:
        return 0
    service = _service()
    if service is None:
        log.info("sheets.skip_not_configured", pending=len(rows))
        return 0
    by_sheet: dict[str, list[SheetsOutbox]] = {}
    for r in rows:
        by_sheet.setdefault(r.sheet, []).append(r)
    sent = 0
    for sheet, items in by_sheet.items():
        try:
            service.spreadsheets().values().append(
                spreadsheetId=settings.ops_sheet_id, range=f"{sheet}!A1", valueInputOption="RAW",
                insertDataOption="INSERT_ROWS", body={"values": [i.row for i in items]},
            ).execute()
            for i in items:
                i.sent_at = utcnow()
            sent += len(items)
        except Exception as e:  # noqa: BLE001 — повторим в следующий раз
            for i in items:
                i.attempts += 1
                i.last_error = str(e)[:300]
            log.warning("sheets.append_failed", sheet=sheet, error=str(e)[:200])
    await s.commit()
    return sent


async def users_snapshot(s: AsyncSession) -> list[list[Any]]:
    """Строки листа users: всё, кроме email и имени."""
    users = (await s.execute(select(User).where(User.deleted_at.is_(None)))).scalars().all()
    balances = dict((await s.execute(select(Wallet.user_id, Wallet.balance))).all())
    bought = dict((await s.execute(
        select(LedgerEntry.user_id, func.sum(LedgerEntry.delta)).where(LedgerEntry.reason == "purchase").group_by(LedgerEntry.user_id)
    )).all())
    paid_rub = dict((await s.execute(
        select(Payment.user_id, func.sum(Payment.amount_minor)).where(Payment.status == "succeeded", Payment.currency == "RUB")
        .group_by(Payment.user_id)
    )).all())
    paid_xtr = dict((await s.execute(
        select(Payment.user_id, func.sum(Payment.amount_minor)).where(Payment.status == "succeeded", Payment.currency == "XTR")
        .group_by(Payment.user_id)
    )).all())
    runs = dict((await s.execute(
        select(Run.user_id, func.count()).where(Run.status == "done").group_by(Run.user_id)
    )).all())
    last_run = dict((await s.execute(select(Run.user_id, func.max(Run.created_at)).group_by(Run.user_id))).all())
    out = []
    for u in users:
        out.append([
            u.user_ref, u.role, str(u.created_at)[:19], str(u.last_seen_at or "")[:19],
            "да" if (u.settings or {}).get("tg_linked") else "",
            balances.get(u.id, 0), bought.get(u.id, 0) or 0,
            round((paid_rub.get(u.id) or 0) / 100, 2), paid_xtr.get(u.id) or 0,
            runs.get(u.id, 0), str(last_run.get(u.id) or "")[:19],
        ])
    return out


async def write_users_snapshot(s: AsyncSession) -> None:
    service = _service()
    if service is None:
        return
    values = [HEADERS["users"], *await users_snapshot(s)]
    service.spreadsheets().values().clear(spreadsheetId=settings.ops_sheet_id, range="users!A:Z").execute()
    service.spreadsheets().values().update(
        spreadsheetId=settings.ops_sheet_id, range="users!A1", valueInputOption="RAW", body={"values": values}
    ).execute()
