"""Рендер отчёта: одна самодостаточная HTML-страница (модель + JS + стили внутри). Из неё же — PDF и PNG (фаза 7)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.config import REPO_ROOT, settings

HERE = Path(__file__).parent

SECTION_TITLES = {
    "tg.overview": "Общее", "tg.rhythm": "Ритм", "tg.clock": "Часы и дни", "tg.dialog": "Диалог",
    "tg.moments": "Монологи и диалоги", "tg.media": "Медиа", "tg.words": "Слова", "tg.laugh_swear": "Смех и мат",
    "tg.names": "Имена", "tg.reactions": "Реакции", "tg.group_life": "Жизнь беседы",
    "tt.views_total": "Просмотры", "tt.chats_counts": "Чаты", "tt.views_rhythm": "Ритм просмотров",
    "tt.sessions": "Сессии", "tt.activity": "Активность", "tt.chat_deep": "Разбор чата", "tt.emoji": "Эмодзи",
    "tt.content": "Содержание",
}


@lru_cache
def _env() -> Environment:
    return Environment(loader=FileSystemLoader(HERE / "templates"), autoescape=select_autoescape(["html"]))


@lru_cache
def _asset(name: str) -> str:
    return (HERE / "assets" / name).read_text(encoding="utf-8")


@lru_cache
def _tokens_css() -> str:
    return Path(settings.tokens_css).read_text(encoding="utf-8")


@lru_cache
def _palettes() -> list[dict[str, Any]]:
    return json.loads((REPO_ROOT / "packages" / "design-tokens" / "palettes.json").read_text(encoding="utf-8"))


def _who(meta: dict[str, Any]) -> str:
    names = [p["name"] for p in meta["participants"]]
    if meta["source"] == "tt":
        return "TikTok" + (f" · чат с {names[1]}" if len(names) > 1 else "")
    if len(names) <= 3:
        return " и ".join(names)
    return f"{', '.join(names[:3])} и ещё {len(names) - 3}"


def render_report(model: dict[str, Any], site_name: str = "Разбор переписки") -> str:
    meta = model["meta"]
    # Экранируем <, >, & — данные внутри <script> не могут закрыть тег или открыть новый.
    data_json = (json.dumps(model, ensure_ascii=False, separators=(",", ":"))
                 .replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026"))
    sections = [{"id": s, "anchor": s.replace(".", "-"), "title": SECTION_TITLES.get(s, s)} for s in meta["sections"]]
    return _env().get_template("report.html").render(
        title=meta["title"] or "Разбор",
        eyebrow="Telegram · разбор чата" if meta["source"] == "tg" else "TikTok · разбор аккаунта",
        who=_who(meta),
        tz=meta["tz"],
        cfg=meta["config"],
        sections=sections,
        palettes=_palettes(),
        generated=meta["generated_at"][:16].replace("T", " ") + " UTC",
        site_url=settings.public_url,
        site_name=site_name,
        tokens_css=_tokens_css(),
        report_css=_asset("report.css"),
        report_js=_asset("report.js"),
        data_json=data_json,
    )
