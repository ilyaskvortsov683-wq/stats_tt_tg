"""Фоновые задачи (arq). Запуск: arq app.workers.tasks.WorkerSettings

v1: выгрузка в Google Sheets, снимок пользователей, очистка старых отчётов.
Фаза 6/7: расчёт разборов и PDF/PNG переедут сюда из BackgroundTasks API.
Фаза 10: синхронизация словарей и архив логов на Google Диск.
"""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import select

from app.core.config import products_config, settings
from app.core.db import SessionLocal, init_models, utcnow
from app.core.logging import configure_logging, log
from app.integrations.sheets import flush_outbox, write_users_snapshot
from app.models import Run


async def startup(_ctx) -> None:
    configure_logging()
    await init_models()


async def flush_sheets(_ctx) -> int:
    async with SessionLocal() as s:
        return await flush_outbox(s)


async def users_snapshot(_ctx) -> None:
    async with SessionLocal() as s:
        await write_users_snapshot(s)


async def cleanup_reports(_ctx) -> int:
    keep = int(products_config().get("report_retention_days", 90))
    removed = 0
    async with SessionLocal() as s:
        old = (await s.execute(select(Run).where(Run.created_at < utcnow() - timedelta(days=keep),
                                                 Run.report_path.is_not(None)))).scalars().all()
        for r in old:
            Path(r.report_path).unlink(missing_ok=True)
            r.report_path = None
            r.deleted_at = r.deleted_at or utcnow()
            removed += 1
        await s.commit()
    log.info("reports.cleanup", removed=removed)
    return removed


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    on_startup = startup
    functions = [flush_sheets, users_snapshot, cleanup_reports]
    cron_jobs = [
        cron(flush_sheets, second=0),
        cron(users_snapshot, minute=set(range(0, 60, 10)), second=30),
        cron(cleanup_reports, hour=4, minute=0),
    ]
