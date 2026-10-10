"""Синтетические данные для страницы «Пример отчёта» и тестов. Все имена и числа выдуманы."""

from __future__ import annotations

import math
import random
from functools import lru_cache
from typing import Any

from app.metrics.packet import PacketV1
from app.metrics.report_model import build_report_model
from app.report.render import render_report

KINDS = ["text", "voice", "video_note", "photo", "video", "sticker", "gif", "file", "audio",
         "tiktok_share", "link", "poll", "location", "contact", "other"]
K = {k: i for i, k in enumerate(KINDS)}
START = 1735680000  # 2024-12-31 21:00 UTC = 2025-01-01 00:00 МСК
MSK = 3 * 3600

TG_SECTIONS = ["tg.overview", "tg.rhythm", "tg.clock", "tg.dialog", "tg.moments", "tg.media", "tg.words",
               "tg.laugh_swear", "tg.names", "tg.reactions"]
TT_SECTIONS = ["tt.views_total", "tt.views_rhythm", "tt.sessions", "tt.activity", "tt.chat_deep", "tt.content"]

VOCAB = [
    ["ладно", "завтра", "люблю", "смотри", "кстати", "котик", "работа", "вечером", "давай", "правда", "мама", "кино"],
    ["окей", "сейчас", "короче", "давай", "тоже", "работа", "игра", "вечером", "завтра", "котик", "футбол", "еда"],
]


def _hour_weight(h: int) -> float:
    return 0.2 + (1.6 if 19 <= h <= 23 else 0.9 if 12 <= h <= 18 else 0.6 if 8 <= h <= 11 else 0.15)


def sample_tg_packet(days: int = 420, seed: int = 7) -> dict[str, Any]:
    rng = random.Random(seed)
    hours = list(range(24))
    weights = [_hour_weight(h) for h in hours]
    ts: list[int] = []
    author: list[int] = []
    kind: list[int] = []
    dur: list[int | None] = []
    fwd: list[int | None] = []
    words: list[int] = []
    laugh: list[int] = []
    for d in range(days):
        if rng.random() < 0.04:
            continue  # редкие дни без переписки
        weekday = (d + 2) % 7  # 2025-01-01 — среда
        volume = 45 + 25 * math.sin(d / 40) + (20 if weekday >= 5 else 0) + rng.gauss(0, 12)
        if d in (43, 189):
            volume *= 4  # «жаркие» дни
        n_clusters = rng.randint(3, 7)
        per = max(int(volume / n_clusters), 2)
        for _ in range(n_clusters):
            h = rng.choices(hours, weights)[0]
            t = START + d * 86400 + h * 3600 + rng.randint(0, 3000)
            a = rng.randint(0, 1)
            for _ in range(max(per + rng.randint(-5, 5), 2)):
                t += rng.randint(8, 240)
                if rng.random() > 0.42:
                    a = 1 - a
                ts.append(t)
                author.append(a)
                r = rng.random()
                k = "text"
                if r < 0.05:
                    k = "voice"
                elif r < 0.06:
                    k = "video_note"
                elif r < 0.12:
                    k = "sticker"
                elif r < 0.15:
                    k = "photo"
                elif r < 0.16:
                    k = "link"
                kind.append(K[k])
                dur.append(rng.randint(4, 150) if k in ("voice", "video_note") else None)
                fwd.append(rng.choice([0, 1, 2, 2]) if rng.random() < 0.03 else None)
                w = rng.randint(1, 14) if k == "text" else 0
                if rng.random() < 0.004:
                    w = rng.randint(60, 160)  # длинное сообщение
                words.append(w)
                laugh.append(1 if k == "text" and rng.random() < (0.11 if a == 0 else 0.06) else 0)
    order = sorted(range(len(ts)), key=ts.__getitem__)
    cols = [ts, author, kind, dur, fwd, words, laugh]
    ts, author, kind, dur, fwd, words, laugh = ([c[i] for i in order] for c in cols)
    n = len(ts)

    swear_ids = ["r:1", "r:2", "r:3"]
    swear_hits = [[i, rng.choice(swear_ids)] for i in range(n) if kind[i] == K["text"] and rng.random() < (0.012 if author[i] == 0 else 0.035)]
    name_ids = ["n:sasha", "n:dima", "n:lena"]
    name_hits = [[i, rng.choices(name_ids, [5, 3, 2])[0]] for i in range(n) if kind[i] == K["text"] and rng.random() < 0.015]
    emojis = ["❤", "😂", "👍", "🔥", "😢"]
    on_msg, who = [], []
    for i in range(n):
        if rng.random() < 0.08:
            e = rng.choices(emojis, [58, 18, 10, 9, 5])[0]
            on_msg.append([i, e, 1])
            who.append([i, 1 - author[i] if rng.random() < 0.9 else author[i], e])
    emoji_hits = [[i, rng.choice(["🥺", "😭", "❤", "😂", "👍", "🤝"]), 1] for i in range(n) if rng.random() < 0.09]
    sticker_hits = [[i, rng.choice(["😂#a1b2c3d4", "🐱#ffe01234", "👍#00aa11bb", "😴#77cc88dd"])] for i in range(n) if kind[i] == K["sticker"]]
    custom_hits = [[i, 0] for i in range(n) if kind[i] == K["text"] and rng.random() < 0.012]

    by_month: dict[str, dict[str, list[list[Any]]]] = {}
    for m in range(14):
        key = f"{2025 + (m // 12)}-{(m % 12) + 1:02d}"
        by_month[key] = {
            f"p{p}": sorted(([w, rng.randint(20, 160)] for w in VOCAB[p]), key=lambda x: -x[1]) for p in (0, 1)
        }
    packet = {
        "schema": "packet.v1", "source": "tg", "chat_kind": "personal", "chat_key": "sample", "title": "Аня и Кирилл",
        "sections": TG_SECTIONS, "tz": "Europe/Moscow", "hide_names": False,
        "participants": [{"key": "p0", "name": "Аня", "is_owner": True}, {"key": "p1", "name": "Кирилл", "is_owner": False}],
        "kinds": KINDS,
        "stream": {"ts": ts, "author": author, "kind": kind, "dur": dur, "fwd": fwd, "words": words, "laugh": laugh},
        "forward_sources": ["Лентач", "Мемы для своих", "Котики каждый день"],
        "words": {"by_month": by_month, "custom_patterns": ["кот*"], "custom_hits": custom_hits,
                  "mask_words": {"0": [["котик", 120], ["кот", 64], ["котенок", 12]]}},
        "laugh_forms": [["ахахах", 820], ["хахаха", 410], ["ахах", 300], ["лол", 80], ["ору", 75]],
        "swear_hits": swear_hits, "swear_labels": {"r:1": "б*я", "r:2": "х*й", "r:3": "п*ц"},
        "name_hits": name_hits, "name_labels": {"n:sasha": "Саша", "n:dima": "Дима", "n:lena": "Лена"},
        "reactions": {"on_msg": on_msg, "who": who},
        "emoji_hits": emoji_hits, "sticker_hits": sticker_hits,
        "events": [{"ts": START + 30 * 86400 + 40000, "actor": 1, "action": "call", "dur": 1260},
                   {"ts": START + 200 * 86400 + 70000, "actor": 0, "action": "call", "dur": 3400}],
        "dict_versions": {"all": "sample"},
        "client": {"app_version": "sample", "parser_version": "sample", "build_ms": 0},
    }
    return packet


def sample_tt_packet(days: int = 200, seed: int = 11) -> tuple[dict[str, Any], list[int]]:
    rng = random.Random(seed)
    views: list[int] = []
    for d in range(days):
        for _ in range(rng.choices([0, 1, 2, 3, 4], [5, 25, 35, 25, 10])[0]):
            h = rng.choices(range(24), [_hour_weight(x) for x in range(24)])[0]
            t = START + d * 86400 + h * 3600 + rng.randint(0, 3000)
            length = int(rng.expovariate(1 / 90)) + 5
            if d == 120:
                length = 600  # долгое «залипание»
            for _ in range(length):
                t += rng.randint(6, 45)
                views.append(t)
    views.sort()
    likes = sorted(rng.sample(views, k=len(views) // 15))
    logins = sorted(START + d * 86400 + rng.choice([5, 6, 7, 18, 20]) * 3600 for d in range(days) if rng.random() < 0.6)
    chat_ts = sorted(START + rng.randint(0, days * 86400) for _ in range(1600))
    chat_author = [rng.randint(0, 1) for _ in chat_ts]
    chat_kind = [K["tiktok_share"] if rng.random() < 0.6 else K["text"] for _ in chat_ts]
    n = len(chat_ts)
    packet = {
        "schema": "packet.v1", "source": "tt", "chat_kind": "personal", "chat_key": "sample-tt", "title": "Ваш TikTok",
        "sections": TT_SECTIONS, "tz": "Europe/Moscow", "hide_names": False,
        "participants": [{"key": "p0", "name": "вы", "is_owner": True}, {"key": "p1", "name": "kirill_k", "is_owner": False}],
        "kinds": KINDS,
        "stream": {"ts": chat_ts, "author": chat_author, "kind": chat_kind, "dur": [None] * n, "fwd": [None] * n,
                   "words": [0] * n, "laugh": [0] * n},
        "tt": {"owner": "вы", "use_history": True, "likes": likes, "favorites": likes[::12], "collections": likes[::400],
               "logins": logins},
        "client": {"app_version": "sample", "parser_version": "sample", "build_ms": 0},
    }
    return packet, views


@lru_cache
def sample_html(source: str) -> str:
    if source == "tt":
        raw, views = sample_tt_packet()
        model = build_report_model(PacketV1.model_validate(raw), views_override=views)
    else:
        model = build_report_model(PacketV1.model_validate(sample_tg_packet()))
    return render_report(model, site_name="Пример отчёта · данные выдуманы")
