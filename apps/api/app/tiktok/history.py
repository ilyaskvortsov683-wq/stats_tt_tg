"""Хранение и склейка истории просмотров TikTok (по согласию пользователя).

Храним только пары (UTC-время, id видео), сжатые zlib и зашифрованные AES-GCM. Дедупликация — по паре,
поэтому повторные просмотры одного видео сохраняются (ошибка исходного ноутбука исправлена).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import uuid
import zlib
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.core.security import current_user, require_csrf
from app.events import emit
from app.models import TtHistory, TtHistoryFile, User

router = APIRouter()
KEY_VERSION = 1


def _key() -> bytes:
    if settings.history_enc_key:
        return base64.b64decode(settings.history_enc_key)
    if not settings.is_local:
        raise RuntimeError("HISTORY_ENC_KEY не задан")
    return hashlib.sha256(b"local-dev-history-key").digest()


def encrypt(views: list[tuple[int, str]]) -> bytes:
    raw = zlib.compress(json.dumps(views, separators=(",", ":")).encode(), 9)
    nonce = os.urandom(12)
    return nonce + AESGCM(_key()).encrypt(nonce, raw, None)


def decrypt(blob: bytes) -> list[tuple[int, str]]:
    raw = AESGCM(_key()).decrypt(blob[:12], blob[12:], None)
    return [(int(t), str(v)) for t, v in json.loads(zlib.decompress(raw))]


def merge(existing: list[tuple[int, str]], new: list[tuple[int, str]]) -> tuple[list[tuple[int, str]], int, int]:
    seen = set(existing)
    added = 0
    out = list(existing)
    for item in new:
        if item not in seen:
            seen.add(item)
            out.append(item)
            added += 1
    out.sort()
    return out, added, len(new) - added


async def load_views(s: AsyncSession, user_id: uuid.UUID) -> list[tuple[int, str]]:
    h = await s.get(TtHistory, user_id)
    return decrypt(h.blob) if h else []


class HistoryFile(BaseModel):
    file_hash: str = Field(max_length=64)
    ts: list[int]
    video: list[str]


class HistoryIn(BaseModel):
    files: list[HistoryFile] = Field(max_length=20)


async def merge_files(s: AsyncSession, user: User, files: list[HistoryFile]) -> dict[str, Any]:
    current = await load_views(s, user.id)
    added = dup = 0
    new_files = 0
    for f in files:
        if len(f.ts) != len(f.video):
            raise HTTPException(422, "length_mismatch")
        known = (await s.execute(select(TtHistoryFile.id).where(
            TtHistoryFile.user_id == user.id, TtHistoryFile.file_hash == f.file_hash))).first()
        pairs = list(zip(f.ts, f.video, strict=True))
        current, a, d = merge(current, pairs)
        added += a
        dup += d
        if not known:
            new_files += 1
            s.add(TtHistoryFile(user_id=user.id, file_hash=f.file_hash, views=len(pairs),
                                period_from=min(f.ts) if f.ts else None, period_to=max(f.ts) if f.ts else None))
    h = await s.get(TtHistory, user.id)
    if h is None:
        h = TtHistory(user_id=user.id, blob=b"", files_count=0)
        s.add(h)
    h.blob = encrypt(current)
    h.key_version = KEY_VERSION
    h.views = len(current)
    h.min_ts = current[0][0] if current else None
    h.max_ts = current[-1][0] if current else None
    h.files_count = (h.files_count or 0) + new_files
    await emit(s, "tt.history_merged", user_ref=user.user_ref, added=added, duplicates=dup, total=len(current))
    return {"added": added, "duplicates": dup, "total": len(current), "min_ts": h.min_ts, "max_ts": h.max_ts,
            "files": h.files_count}


@router.post("/tiktok/history", dependencies=[Depends(require_csrf)])
async def upload_history(body: HistoryIn, user: User = Depends(current_user),
                         s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    if not (user.consents or {}).get("store_tt_history"):
        raise HTTPException(409, "consent_required")
    result = await merge_files(s, user, body.files)
    await s.commit()
    return result


@router.get("/tiktok/history/summary")
async def history_summary(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    h = await s.get(TtHistory, user.id)
    if not h:
        return {"total": 0}
    return {"total": h.views, "min_ts": h.min_ts, "max_ts": h.max_ts, "files": h.files_count}


@router.delete("/tiktok/history", dependencies=[Depends(require_csrf)])
async def delete_history(request: Request, user: User = Depends(current_user),
                         s: AsyncSession = Depends(get_session)) -> dict[str, bool]:
    await s.execute(delete(TtHistory).where(TtHistory.user_id == user.id))
    await s.execute(delete(TtHistoryFile).where(TtHistoryFile.user_id == user.id))
    await emit(s, "tt.history_deleted", user_ref=user.user_ref, request_id=request.state.request_id)
    await s.commit()
    return {"ok": True}
