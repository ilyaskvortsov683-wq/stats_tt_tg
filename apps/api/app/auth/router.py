"""Вход: Google OAuth (основной), Telegram (резервный), dev-вход локально. Профиль пользователя."""

from __future__ import annotations

import base64
import hashlib
import secrets
from datetime import timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.ledger import balance
from app.core.config import settings
from app.core.db import get_session, utcnow
from app.core.security import (
    SESSION_COOKIE,
    create_session,
    current_user,
    hash_token,
    new_token,
    require_csrf,
    set_session_cookies,
    user_ref_for,
    verify_telegram_login,
)
from app.events import emit
from app.models import AuthSession, Identity, TelegramLinkToken, TtHistory, User

router = APIRouter()
_signer = URLSafeTimedSerializer(settings.session_secret, salt="oauth")

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"


async def upsert_user(s: AsyncSession, provider: str, subject: str, *, email: str | None, name: str | None,
                      avatar: str | None = None) -> User:
    ident = (await s.execute(select(Identity).where(Identity.provider == provider, Identity.subject == subject))).scalar_one_or_none()
    user: User | None = await s.get(User, ident.user_id) if ident else None
    if user is None and email:
        user = (await s.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        user = User(email=email, display_name=name, avatar_url=avatar, user_ref="pending")
        s.add(user)
        await s.flush()
        user.user_ref = user_ref_for(user.id)
    if ident is None:
        s.add(Identity(user_id=user.id, provider=provider, subject=subject))
    if email and email.lower() in settings.admin_email_set:
        user.role = "admin"
    user.last_seen_at = utcnow()
    if name and not user.display_name:
        user.display_name = name
    return user


def _redirect_with_session(token: str, to: str) -> RedirectResponse:
    resp = RedirectResponse(to, status_code=302)
    set_session_cookies(resp, token)
    return resp


@router.get("/auth/config")
async def auth_config() -> dict[str, Any]:
    return {
        "google": bool(settings.google_client_id),
        "telegram_bot": settings.tg_bot_username or None,
        "dev_login": settings.is_local and settings.dev_login,
    }


@router.get("/auth/google/login")
async def google_login() -> RedirectResponse:
    if not settings.google_client_id:
        raise HTTPException(503, "google_not_configured")
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": f"{settings.api_url}/api/v1/auth/google/callback",
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    resp = RedirectResponse(f"{GOOGLE_AUTH}?{urlencode(params)}")
    resp.set_cookie("oauth", _signer.dumps({"s": state, "v": verifier}), httponly=True, secure=not settings.is_local,
                    samesite="lax", max_age=600)
    return resp


@router.get("/auth/google/callback")
async def google_callback(request: Request, code: str, state: str, s: AsyncSession = Depends(get_session)) -> RedirectResponse:
    try:
        saved = _signer.loads(request.cookies.get("oauth", ""), max_age=600)
    except BadSignature as e:
        raise HTTPException(400, "oauth_state_invalid") from e
    if saved.get("s") != state:
        raise HTTPException(400, "oauth_state_mismatch")
    async with httpx.AsyncClient(timeout=15) as c:
        tok = await c.post(GOOGLE_TOKEN, data={
            "code": code, "client_id": settings.google_client_id, "client_secret": settings.google_client_secret,
            "redirect_uri": f"{settings.api_url}/api/v1/auth/google/callback", "grant_type": "authorization_code",
            "code_verifier": saved["v"],
        })
        if tok.status_code != 200:
            await emit(s, "auth.failed", level="warning", provider="google", status=tok.status_code)
            await s.commit()
            raise HTTPException(400, "oauth_exchange_failed")
        info = (await c.get(GOOGLE_USERINFO, headers={"Authorization": f"Bearer {tok.json()['access_token']}"})).json()
    if not info.get("email_verified"):
        raise HTTPException(400, "email_not_verified")
    user = await upsert_user(s, "google", info["sub"], email=info["email"].lower(), name=info.get("name"),
                             avatar=info.get("picture"))
    token = await create_session(s, user, request.headers.get("user-agent"))
    await emit(s, "auth.login", user_ref=user.user_ref, provider="google")
    await s.commit()
    return _redirect_with_session(token, f"{settings.public_url}/app")


class TelegramLoginIn(BaseModel):
    id: int
    first_name: str | None = None
    last_name: str | None = None
    username: str | None = None
    photo_url: str | None = None
    auth_date: int
    hash: str


@router.post("/auth/telegram")
async def telegram_login(body: TelegramLoginIn, request: Request, response: Response,
                         s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    data = {k: str(v) for k, v in body.model_dump().items() if v is not None}
    if not settings.tg_bot_token or not verify_telegram_login(data, settings.tg_bot_token):
        raise HTTPException(400, "telegram_auth_invalid")
    name = " ".join(x for x in (body.first_name, body.last_name) if x) or body.username
    user = await upsert_user(s, "telegram", str(body.id), email=None, name=name, avatar=body.photo_url)
    user.settings = {**(user.settings or {}), "tg_linked": True}
    token = await create_session(s, user, request.headers.get("user-agent"))
    await emit(s, "auth.login", user_ref=user.user_ref, provider="telegram")
    await s.commit()
    set_session_cookies(response, token)
    return {"ok": True}


class DevLoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)


@router.post("/auth/dev-login")
async def dev_login(body: DevLoginIn, request: Request, response: Response,
                    s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    if not (settings.is_local and settings.dev_login):
        raise HTTPException(404)
    email = body.email.strip().lower()
    user = await upsert_user(s, "dev", email, email=email, name=email.split("@")[0])
    token = await create_session(s, user, request.headers.get("user-agent"))
    await emit(s, "auth.login", user_ref=user.user_ref, provider="dev")
    await s.commit()
    set_session_cookies(response, token)
    return {"ok": True}


@router.post("/auth/logout", dependencies=[Depends(require_csrf)])
async def logout(request: Request, response: Response, s: AsyncSession = Depends(get_session)) -> dict[str, bool]:
    sid = request.cookies.get(SESSION_COOKIE)
    if sid:
        await s.execute(delete(AuthSession).where(AuthSession.token_hash == hash_token(sid)))
        await s.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
async def me(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    providers = (await s.execute(select(Identity.provider).where(Identity.user_id == user.id))).scalars().all()
    hist = await s.get(TtHistory, user.id)
    user.last_seen_at = utcnow()
    await s.commit()
    return {
        "user_ref": user.user_ref,
        "email": user.email,
        "name": user.display_name,
        "avatar_url": user.avatar_url,
        "role": user.role,
        "balance": await balance(s, user.id),
        "tz": user.tz,
        "city": user.city,
        "settings": user.settings or {},
        "consents": user.consents or {},
        "telegram_linked": "telegram" in providers,
        "tt_history": {"views": hist.views, "files": hist.files_count, "min_ts": hist.min_ts, "max_ts": hist.max_ts} if hist else None,
    }


class SettingsIn(BaseModel):
    tz: str | None = None
    city: str | None = None
    settings: dict[str, Any] | None = None
    consents: dict[str, Any] | None = None


@router.patch("/me/settings", dependencies=[Depends(require_csrf)])
async def update_settings(body: SettingsIn, user: User = Depends(current_user),
                          s: AsyncSession = Depends(get_session)) -> dict[str, bool]:
    if body.tz:
        from zoneinfo import ZoneInfo

        try:
            ZoneInfo(body.tz)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, "bad_timezone") from e
        user.tz = body.tz
    if body.city is not None:
        user.city = body.city[:100]
    if body.settings is not None:
        user.settings = {**(user.settings or {}), **body.settings}
    if body.consents is not None:
        user.consents = {**(user.consents or {}), **body.consents, "updated_at": utcnow().isoformat()}
    await s.commit()
    return {"ok": True}


@router.post("/me/telegram-link", dependencies=[Depends(require_csrf)])
async def telegram_link(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)) -> dict[str, str]:
    if not settings.tg_bot_username:
        raise HTTPException(503, "bot_not_configured")
    token = new_token()[:32]
    s.add(TelegramLinkToken(token_hash=hash_token(token), user_id=user.id, expires_at=utcnow() + timedelta(minutes=10)))
    await s.commit()
    return {"url": f"https://t.me/{settings.tg_bot_username}?start=link_{token}"}


@router.delete("/me", dependencies=[Depends(require_csrf)])
async def delete_me(response: Response, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)) -> dict[str, bool]:
    """Удаление аккаунта: история, сессии, идентичности. Платежи остаются обезличенными (бухучёт)."""
    await s.execute(delete(TtHistory).where(TtHistory.user_id == user.id))
    await s.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    await s.execute(delete(Identity).where(Identity.user_id == user.id))
    user.email = None
    user.display_name = None
    user.avatar_url = None
    user.deleted_at = utcnow()
    await emit(s, "account.deleted", user_ref=user.user_ref)
    await s.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}
