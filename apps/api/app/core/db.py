"""Подключение к БД. Прод — PostgreSQL (asyncpg), локально и в тестах — SQLite (aiosqlite)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import settings


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(UTC)


def aware(dt: datetime | None) -> datetime | None:
    """SQLite теряет таймзону — считаем такие даты UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _make_engine(url: str):
    if url.startswith("sqlite"):
        path = url.split("///", 1)[-1]
        if path and path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        # Без пула: соединение не переживает event loop (важно для тестов и dev-сервера с перезапуском).
        return create_async_engine(url, poolclass=NullPool)
    return create_async_engine(url, pool_pre_ping=True, pool_size=10, max_overflow=10)


engine = _make_engine(settings.database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def init_models() -> None:
    """v1: создаём таблицы напрямую. В фазе 4 заменить на миграции Alembic."""
    from app import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
