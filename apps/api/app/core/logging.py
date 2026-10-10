"""Структурное логирование (JSON) с вычисткой персональных данных. Правила — docs/14-logging.md."""

from __future__ import annotations

import logging
import re
import sys
from typing import Any

import structlog

# Ключи, значения которых никогда не попадают в логи.
FORBIDDEN_KEYS = {
    "text", "content", "message_text", "messages", "email", "tg_id", "telegram_id", "phone", "display_name",
    "chat_title", "title", "participants", "token", "cookie", "authorization", "password", "secret",
    "promo_code", "code", "ip", "words", "packet", "body",
}
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"\+?\d[\d\s()-]{9,}\d")
MAX_LEN = 200


def scrub_value(value: Any) -> Any:
    if isinstance(value, str):
        value = EMAIL_RE.sub("[email]", value)
        value = PHONE_RE.sub("[phone]", value)
        if len(value) > MAX_LEN:
            value = value[:MAX_LEN] + "…"
        return value
    if isinstance(value, dict):
        return {k: ("[scrubbed]" if k.lower() in FORBIDDEN_KEYS else scrub_value(v)) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [scrub_value(v) for v in value[:20]]
    return value


def scrub_pii(_logger: Any, _method: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    for key in list(event_dict):
        if key in ("event", "level", "timestamp", "logger"):
            if key == "event":
                event_dict[key] = scrub_value(event_dict[key])
            continue
        if key.lower() in FORBIDDEN_KEYS:
            event_dict[key] = "[scrubbed]"
        else:
            event_dict[key] = scrub_value(event_dict[key])
    return event_dict


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.format_exc_info,
            scrub_pii,
            structlog.processors.JSONRenderer(ensure_ascii=False),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level)),
        cache_logger_on_first_use=True,
    )


log = structlog.get_logger()
