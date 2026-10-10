"""Сессии, CSRF, псевдонимы пользователей, проверка подписей Telegram."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
import uuid
from datetime import timedelta

from fastapi import Cookie, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import aware, get_session, utcnow
from app.models import AuthSession, User

SESSION_COOKIE = "sid"
CSRF_COOKIE = "csrf"
SESSION_DAYS = 30


def user_ref_for(user_id: uuid.UUID) -> str:
    """Псевдоним для логов и Google Sheets: по нему админ находит человека в админке, но email не раскрывается."""
    digest = hmac.new(settings.user_ref_secret.encode(), str(user_id).encode(), hashlib.sha256).hexdigest()
    return "u_" + digest[:12]


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def chat_fingerprint(user_id: uuid.UUID, source: str, chat_key: str) -> str:
    return hashlib.sha256(f"{user_id}:{source}:{chat_key}".encode()).hexdigest()


async def create_session(s: AsyncSession, user: User, user_agent: str | None) -> str:
    token = new_token()
    s.add(AuthSession(
        user_id=user.id, token_hash=hash_token(token),
        expires_at=utcnow() + timedelta(days=SESSION_DAYS), user_agent=(user_agent or "")[:300],
    ))
    return token


def set_session_cookies(response, token: str) -> None:
    secure = not settings.is_local
    max_age = SESSION_DAYS * 86400
    response.set_cookie(SESSION_COOKIE, token, httponly=True, secure=secure, samesite="lax", max_age=max_age, path="/")
    response.set_cookie(CSRF_COOKIE, new_token(), httponly=False, secure=secure, samesite="lax", max_age=max_age, path="/")


async def current_user_optional(
    request: Request,
    s: AsyncSession = Depends(get_session),
    sid: str | None = Cookie(default=None),
) -> User | None:
    if not sid:
        return None
    row = (await s.execute(select(AuthSession).where(AuthSession.token_hash == hash_token(sid)))).scalar_one_or_none()
    if not row or aware(row.expires_at) < utcnow():
        return None
    user = await s.get(User, row.user_id)
    if not user or user.deleted_at:
        return None
    request.state.user_ref = user.user_ref
    return user


async def current_user(user: User | None = Depends(current_user_optional)) -> User:
    if not user:
        raise HTTPException(401, "not_authenticated")
    return user


async def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "admin_only")
    return user


async def require_csrf(
    request: Request,
    x_csrf_token: str | None = Header(default=None),
    csrf: str | None = Cookie(default=None),
) -> None:
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    if not csrf or not x_csrf_token or not hmac.compare_digest(csrf, x_csrf_token):
        raise HTTPException(403, "csrf_failed")


def verify_telegram_login(data: dict[str, str], bot_token: str, max_age: int = 86400) -> bool:
    """Проверка данных виджета «Войти через Telegram» (https://core.telegram.org/widgets/login#checking-authorization)."""
    received = data.get("hash", "")
    pairs = sorted(f"{k}={v}" for k, v in data.items() if k != "hash" and v is not None)
    secret = hashlib.sha256(bot_token.encode()).digest()
    expected = hmac.new(secret, "\n".join(pairs).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        return False
    try:
        return time.time() - int(data.get("auth_date", "0")) <= max_age
    except ValueError:
        return False


def verify_webapp_init_data(init_data: str, bot_token: str, max_age: int = 86400) -> dict[str, str] | None:
    """Проверка initData Telegram Mini App (HMAC с ключом WebAppData)."""
    from urllib.parse import parse_qsl

    data = dict(parse_qsl(init_data, keep_blank_values=True))
    received = data.pop("hash", "")
    check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        return None
    if time.time() - int(data.get("auth_date", "0")) > max_age:
        return None
    return data
