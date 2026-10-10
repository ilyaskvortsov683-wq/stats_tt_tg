"""ORM-модели. Схема и смысл полей — docs/07-database.md."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


TS = DateTime(timezone=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    email: Mapped[str | None] = mapped_column(String(320), unique=True, nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(200))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    role: Mapped[str] = mapped_column(String(20), default="user")
    user_ref: Mapped[str] = mapped_column(String(40), unique=True)
    tz: Mapped[str] = mapped_column(String(64), default="Europe/Moscow")
    city: Mapped[str | None] = mapped_column(String(100))
    settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    consents: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(TS)
    deleted_at: Mapped[datetime | None] = mapped_column(TS)


class Identity(Base):
    __tablename__ = "identities"
    __table_args__ = (UniqueConstraint("provider", "subject"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20))  # google | telegram
    subject: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class AuthSession(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(TS)
    user_agent: Mapped[str | None] = mapped_column(String(300))


class TelegramLinkToken(Base):
    __tablename__ = "telegram_link_tokens"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(TS)
    used_at: Mapped[datetime | None] = mapped_column(TS)


class Wallet(Base):
    __tablename__ = "wallets"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    balance: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow)


class LedgerEntry(Base):
    __tablename__ = "ledger"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(30))  # purchase | promo | admin_grant | run_reserve | run_release | refund
    payment_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    promo_redemption_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    run_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    note: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (UniqueConstraint("provider", "provider_payment_id"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    provider: Mapped[str] = mapped_column(String(20))  # yookassa | stars | mock
    provider_payment_id: Mapped[str | None] = mapped_column(String(100))
    product_id: Mapped[str] = mapped_column(String(40))
    amount_minor: Mapped[int] = mapped_column(Integer)  # копейки или звёзды
    currency: Mapped[str] = mapped_column(String(8))  # RUB | XTR
    runs: Mapped[int] = mapped_column(Integer)
    promo_redemption_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | succeeded | canceled | refunded
    raw: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow)


class PromoCode(Base):
    __tablename__ = "promo_codes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    kind: Mapped[str] = mapped_column(String(20))  # runs | discount_percent | fixed_price
    value: Mapped[int] = mapped_column(Integer)
    scope: Mapped[str] = mapped_column(String(10))  # personal | global
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    max_redemptions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    redemptions: Mapped[int] = mapped_column(Integer, default=0)
    valid_from: Mapped[datetime | None] = mapped_column(TS)
    valid_until: Mapped[datetime | None] = mapped_column(TS)
    disabled_at: Mapped[datetime | None] = mapped_column(TS)
    note: Mapped[str | None] = mapped_column(String(300))
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class PromoRedemption(Base):
    __tablename__ = "promo_redemptions"
    __table_args__ = (UniqueConstraint("promo_code_id", "user_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    promo_code_id: Mapped[int] = mapped_column(ForeignKey("promo_codes.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    applied: Mapped[bool] = mapped_column(Boolean, default=False)  # для скидок: применена к платежу
    payment_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    source: Mapped[str] = mapped_column(String(4))
    chat_kind: Mapped[str] = mapped_column(String(12))
    chat_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    sections: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="reserved")
    charge: Mapped[str] = mapped_column(String(16))  # paid | free_rerun | admin
    error_code: Mapped[str | None] = mapped_column(String(60))
    packet_bytes: Mapped[int | None] = mapped_column(Integer)
    timings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    report_path: Mapped[str | None] = mapped_column(String(300))
    title: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(TS)
    deleted_at: Mapped[datetime | None] = mapped_column(TS)


class TtHistory(Base):
    __tablename__ = "tt_history"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    blob: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[int] = mapped_column(Integer, default=1)
    views: Mapped[int] = mapped_column(Integer, default=0)
    min_ts: Mapped[int | None] = mapped_column(BigInteger)
    max_ts: Mapped[int | None] = mapped_column(BigInteger)
    files_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow)


class TtHistoryFile(Base):
    __tablename__ = "tt_history_files"
    __table_args__ = (UniqueConstraint("user_id", "file_hash"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    file_hash: Mapped[str] = mapped_column(String(64))
    views: Mapped[int] = mapped_column(Integer)
    period_from: Mapped[int | None] = mapped_column(BigInteger)
    period_to: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class Reminder(Base):
    __tablename__ = "reminders"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    tg_chat_id: Mapped[int] = mapped_column(BigInteger)
    kind: Mapped[str] = mapped_column(String(30))  # tt_export_ready | tt_refresh
    due_at: Mapped[datetime] = mapped_column(TS, index=True)
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending | sent | canceled
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    sent_at: Mapped[datetime | None] = mapped_column(TS)


class DictionaryVersion(Base):
    __tablename__ = "dictionary_versions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version: Mapped[str] = mapped_column(String(40))
    source: Mapped[str] = mapped_column(String(10))  # seed | sheet
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    valid: Mapped[bool] = mapped_column(Boolean, default=True)
    errors: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class Event(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(TS, default=utcnow, index=True)
    level: Mapped[str] = mapped_column(String(10), default="info")
    type: Mapped[str] = mapped_column(String(60), index=True)
    user_ref: Mapped[str | None] = mapped_column(String(40), index=True)
    run_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(40))
    source: Mapped[str] = mapped_column(String(10), default="api")
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class AdminAudit(Base):
    __tablename__ = "admin_audit"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    admin_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    action: Mapped[str] = mapped_column(String(60))
    target: Mapped[str | None] = mapped_column(String(100))
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    ts: Mapped[datetime] = mapped_column(TS, default=utcnow)


class SheetsOutbox(Base):
    __tablename__ = "sheets_outbox"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sheet: Mapped[str] = mapped_column(String(30))
    row: Mapped[list[Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    sent_at: Mapped[datetime | None] = mapped_column(TS)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)
