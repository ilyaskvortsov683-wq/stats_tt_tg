"""Бизнес-события: таблица events + структурный лог + зеркало в Google Sheets. Каталог — docs/14-logging.md."""

from __future__ import annotations

import uuid
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import scrub_value
from app.models import Event

log = structlog.get_logger()

# Какие события зеркалируются в лист «events» Google-таблицы (без ПД, только user_ref).
SHEETS_EVENTS = {
    "auth.login", "auth.tg_linked", "upload.parsed", "upload.failed", "analysis.free_computed", "run.reserved",
    "run.done", "run.failed", "payment.succeeded", "payment.refunded", "stars.paid", "promo.redeemed",
    "promo.redeem_failed", "tt.history_merged", "reminder.created", "reminder.sent", "dict.sync_invalid",
}


async def emit(
    s: AsyncSession,
    type_: str,
    *,
    level: str = "info",
    user_ref: str | None = None,
    run_id: uuid.UUID | None = None,
    request_id: str | None = None,
    source: str = "api",
    **data: Any,
) -> None:
    clean = scrub_value(data)
    s.add(Event(type=type_, level=level, user_ref=user_ref, run_id=run_id, request_id=request_id, source=source, data=clean))
    getattr(log, level if level in ("info", "warning", "error") else "info")(
        type_, user_ref=user_ref, run_id=str(run_id) if run_id else None, request_id=request_id, **clean
    )
    if type_ in SHEETS_EVENTS or level == "error":
        from app.integrations.sheets import enqueue_event

        await enqueue_event(s, type_, level, user_ref, run_id, clean)
