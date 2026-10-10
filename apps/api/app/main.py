"""Точка входа API: uvicorn app.main:app"""

from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.admin.router import router as admin_router
from app.auth.router import router as auth_router
from app.billing.router import router as billing_router
from app.core.config import settings
from app.core.db import init_models
from app.core.logging import configure_logging
from app.misc_router import router as misc_router
from app.runs.router import router as runs_router
from app.tiktok.history import router as tiktok_router

configure_logging()
log = structlog.get_logger()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_models()
    log.info("api.started", env=settings.env)
    yield


app = FastAPI(title="stats_tt_tg API", version="0.1.0", lifespan=lifespan,
              docs_url="/api/docs" if settings.is_local else None, openapi_url="/api/openapi.json" if settings.is_local else None)

if settings.is_local:
    app.add_middleware(CORSMiddleware, allow_origins=[settings.public_url], allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
    request.state.request_id = request_id
    structlog.contextvars.bind_contextvars(request_id=request_id)
    started = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("http.unhandled", path=request.url.path)
        response = JSONResponse({"error": {"code": "internal", "request_id": request_id}}, status_code=500)
    response.headers["X-Request-Id"] = request_id
    if request.url.path != "/healthz":
        log.info("http.request", method=request.method, path=request.url.path, status=response.status_code,
                 ms=int((time.monotonic() - started) * 1000))
    structlog.contextvars.clear_contextvars()
    return response


for r in (auth_router, billing_router, runs_router, tiktok_router, admin_router, misc_router):
    app.include_router(r, prefix="/api/v1")


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
