"""Платные метрики: из пакета агрегатов строится «модель отчёта» report.v1.

Модель хранит факты с точностью до дня (ряды по дням, часы по дням, списки моментов), поэтому в готовом
отчёте пользователь может выбрать ЛЮБОЙ период в любой сводке — агрегаты за период пересчитывает маленький
JS внутри отчёта (app/report/assets/report.js). Описание полей — docs/13-reports-export.md.

Код живёт только на сервере (CLAUDE.md, правило 4).
"""

from __future__ import annotations

import statistics
import time
from bisect import bisect_right
from collections import Counter
from datetime import UTC, datetime
from typing import Any

from app.core.config import metrics_config
from app.metrics.clock import Clock
from app.metrics.packet import PacketV1

REPLY_EDGES = [0, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 10800, 21600, 43200]
NB = len(REPLY_EDGES) - 1


def _sparse(counter: Counter) -> list[list[Any]]:
    return [[*k, v] for k, v in counter.items()]


class Days:
    """Диапазон дней отчёта и перевод времени в индекс дня."""

    def __init__(self, clock: Clock, stamps: list[int]):
        self.clock = clock
        if stamps:
            self.d0 = clock.day(min(stamps))
            self.d1 = clock.day(max(stamps))
        else:
            self.d0 = self.d1 = clock.day(int(time.time()))
        self.n = self.d1 - self.d0 + 1

    def idx(self, ts: int) -> int:
        return self.clock.day(ts) - self.d0

    def zeros(self) -> list[int]:
        return [0] * self.n


def _meta(packet: PacketV1, cfg: dict[str, Any], sections: list[str]) -> dict[str, Any]:
    return {
        "source": packet.source,
        "chat_kind": packet.chat_kind,
        "title": packet.title,
        "tz": packet.tz,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "participants": [p.model_dump() for p in packet.participants],
        "sections": sections,
        "hide_names": packet.hide_names,
        "dict_versions": packet.dict_versions or {},
        "config": {
            "pause_hours": cfg["pause_hours"],
            "reply_max_hours": cfg["reply_max_hours"],
            "monologue_gap_min": cfg["monologue_gap_min"],
            "dialog_gap_min": cfg["dialog_gap_min"],
            "tt_session_gap_min": cfg["tt_session_gap_min"],
            "reply_edges": REPLY_EDGES,
        },
    }


def applicable_sections(packet: PacketV1) -> list[str]:
    from app.core.config import section_info

    # tt.chats_counts — бесплатная сводка по всем чатам, видна только в приложении (в пакете один выбранный чат).
    out = ["tg.overview"] if packet.source == "tg" else ["tt.views_total"]
    for s in packet.sections:
        info = section_info(s)
        if not info or s in out or s == "tt.chats_counts" or not s.startswith(packet.source + "."):
            continue
        only = info.get("only")
        if only and only != packet.chat_kind:
            continue
        out.append(s)
    return out


# ----------------------------------------------------------------------------------------------- Telegram

def build_tg(packet: PacketV1, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or metrics_config()
    clock = Clock(packet.tz)
    st = packet.stream
    n = len(st.ts)
    P = max(len(packet.participants), 1)
    event_ts = [e.ts for e in packet.events or []]
    days = Days(clock, st.ts + event_ts)
    D = days.n
    sections = applicable_sections(packet)
    want = set(sections)

    di = [days.idx(t) for t in st.ts]
    hr = [clock.hour(t) for t in st.ts]
    authors = st.author

    msgs = [days.zeros() for _ in range(P)]
    words = [days.zeros() for _ in range(P)]
    for i in range(n):
        msgs[authors[i]][di[i]] += 1
        words[authors[i]][di[i]] += st.words[i]

    hgroups = P if P <= 4 else 1
    hours = [[0] * (D * 24) for _ in range(hgroups)]
    for i in range(n):
        hours[authors[i] if hgroups > 1 else 0][di[i] * 24 + hr[i]] += 1

    model: dict[str, Any] = {
        "schema": "report.v1",
        "meta": _meta(packet, cfg, sections),
        "days": {"start": clock.day_str(days.d0), "n": D},
        "series": {"msgs": msgs, "words": words},
        "hours": hours,
        "hours_by_participant": hgroups > 1,
    }
    series = model["series"]

    if "tg.media" in want:
        kind_idx = {k: i for i, k in enumerate(packet.kinds)}
        tracked = {
            "voice": ("voice_n", "voice_sec"), "video_note": ("vnote_n", "vnote_sec"),
            "photo": ("photo", None), "video": ("video", None), "sticker": ("sticker", None),
            "gif": ("gif", None), "file": ("file", None), "audio": ("audio", None), "link": ("link", None),
            "poll": ("poll", None),
        }
        rev = {kind_idx[k]: v for k, v in tracked.items() if k in kind_idx}
        for cnt, dur in tracked.values():
            series[cnt] = [days.zeros() for _ in range(P)]
            if dur:
                series[dur] = [days.zeros() for _ in range(P)]
        series["fwd"] = [days.zeros() for _ in range(P)]
        fwd_src: Counter = Counter()
        for i in range(n):
            a, d = authors[i], di[i]
            spec = rev.get(st.kind[i])
            if spec:
                series[spec[0]][a][d] += 1
                if spec[1] and st.dur[i]:
                    series[spec[1]][a][d] += int(st.dur[i])
            if st.fwd[i] is not None:
                series["fwd"][a][d] += 1
                fwd_src[(d, st.fwd[i], a)] += 1
        model["forward_sources"] = packet.forward_sources
        model["fwd_src"] = _sparse(fwd_src)
        calls_n, calls_sec = days.zeros(), days.zeros()
        for e in packet.events or []:
            if e.action == "call":
                d = days.idx(e.ts)
                calls_n[d] += 1
                calls_sec[d] += int(e.dur or 0)
        series["calls_n"], series["calls_sec"] = [calls_n], [calls_sec]

    if "tg.dialog" in want or "tg.moments" in want:
        model.update(_dialog_facts(packet, cfg, di, days, P, want))

    if "tg.words" in want and packet.words:
        model["words_by_month"] = packet.words.by_month
        model["custom_patterns"] = packet.words.custom_patterns
        cust: Counter = Counter()
        for i, k in packet.words.custom_hits:
            cust[(di[i], authors[i], k)] += 1
        model["custom"] = _sparse(cust)
        model["mask_words"] = packet.words.mask_words

    if "tg.laugh_swear" in want:
        laugh = [days.zeros() for _ in range(P)]
        for i in range(n):
            if st.laugh[i]:
                laugh[authors[i]][di[i]] += 1
        series["laugh"] = laugh
        swear = [days.zeros() for _ in range(P)]
        roots: Counter = Counter()
        for i, rid in packet.swear_hits or []:
            swear[authors[i]][di[i]] += 1
            roots[(di[i], authors[i], rid)] += 1
        series["swear"] = swear
        model["swear_roots"] = _sparse(roots)
        model["swear_labels"] = packet.swear_labels or {}
        model["laugh_forms"] = packet.laugh_forms or []

    if "tg.names" in want:
        names: Counter = Counter()
        for i, nid in packet.name_hits or []:
            names[(di[i], authors[i], nid)] += 1
        model["names"] = _sparse(names)
        model["name_labels"] = packet.name_labels or {}

    if "tg.reactions" in want and packet.reactions:
        recv = [days.zeros() for _ in range(P)]
        emo: Counter = Counter()
        for i, e, c in packet.reactions.on_msg:
            if 0 <= i < n:
                recv[authors[i]][di[i]] += c
                emo[(di[i], e)] += c
        who: Counter = Counter()
        for i, r, _e in packet.reactions.who:
            if 0 <= i < n and 0 <= r < P:
                who[(di[i], r, authors[i])] += 1
        series["reactions_recv"] = recv
        model["reaction_emoji"] = _sparse(emo)
        model["who_whom"] = _sparse(who)
        et: Counter = Counter()
        for i, e, c in packet.emoji_hits or []:
            et[(di[i], authors[i], e)] += c
        model["emoji_text"] = _sparse(et)
        stk: Counter = Counter()
        for i, label in packet.sticker_hits or []:
            stk[(di[i], authors[i], label)] += 1
        model["stickers"] = _sparse(stk)

    if "tg.group_life" in want:
        model["events"] = [
            {"d": days.idx(e.ts), "ts": e.ts, "actor": e.actor, "action": e.action, "title": e.title, "count": e.count}
            for e in packet.events or [] if e.action in ("title", "invite", "remove", "join_link")
        ]
    return model


def _top_union(items: list[dict[str, Any]], keys: list[str], k: int) -> list[dict[str, Any]]:
    chosen: dict[int, dict[str, Any]] = {}
    for key in keys:
        for it in sorted(items, key=lambda x: x[key], reverse=True)[:k]:
            chosen[it["i0"]] = it
    return sorted(chosen.values(), key=lambda x: x["i0"])


def _dialog_facts(packet: PacketV1, cfg: dict[str, Any], di: list[int], days: Days, P: int,
                  want: set[str]) -> dict[str, Any]:
    st = packet.stream
    ts, au, wd = st.ts, st.author, st.words
    n = len(ts)
    out: dict[str, Any] = {}
    pause = int(cfg["pause_hours"] * 3600)
    reply_max = int(cfg["reply_max_hours"] * 3600)
    K = int(cfg["top_moments"])

    if "tg.dialog" in want:
        firsts = [days.zeros() for _ in range(P)]
        reply = [[0] * (days.n * NB) for _ in range(P)] if P <= 4 else []
        gaps: list[tuple[int, int, int]] = []
        for i in range(n):
            if i == 0 or ts[i] - ts[i - 1] >= pause:
                firsts[au[i]][di[i]] += 1
            if i > 0:
                delta = ts[i] - ts[i - 1]
                gaps.append((delta, ts[i - 1], ts[i]))
                if reply and au[i] != au[i - 1] and 0 <= delta <= reply_max:
                    b = min(bisect_right(REPLY_EDGES, delta) - 1, NB - 1)
                    reply[au[i]][di[i] * NB + b] += 1
        gaps.sort(reverse=True)
        out["firsts"] = firsts
        out["reply_bins"] = reply
        out["gaps"] = [{"from": a, "to": b, "d0": days.idx(a), "d1": days.idx(b)} for _, a, b in gaps[: int(cfg["top_gaps"])]]

    if "tg.moments" in want:
        mono_gap = int(cfg["monologue_gap_min"] * 60)
        dlg_gap = int(cfg["dialog_gap_min"] * 60)
        monologues: list[dict[str, Any]] = []
        i = 0
        while i < n:
            j = i
            w = wd[i]
            while j + 1 < n and au[j + 1] == au[i] and ts[j + 1] - ts[j] <= mono_gap:
                j += 1
                w += wd[j]
            if j > i:
                monologues.append({"p": au[i], "from": ts[i], "to": ts[j], "msgs": j - i + 1, "words": w,
                                   "i0": i, "i1": j, "d": di[i]})
            i = j + 1
        dialogs: list[dict[str, Any]] = []
        i = 0
        while i < n:
            j = i
            while j + 1 < n and ts[j + 1] - ts[j] <= dlg_gap:
                j += 1
            seg = range(i, j + 1)
            who = Counter(au[k] for k in seg)
            if len(who) >= 2 and j - i + 1 >= 4:
                dialogs.append({
                    "from": ts[i], "to": ts[j], "dur": ts[j] - ts[i], "msgs": j - i + 1,
                    "words": sum(wd[k] for k in seg), "i0": i, "i1": j, "d": di[i],
                    "by": [who.get(p, 0) for p in range(P)] if P <= 4 else [],
                })
            i = j + 1
        out["monologues"] = _top_union(monologues, ["msgs", "words"], K)
        out["dialogs"] = _top_union(dialogs, ["dur", "msgs", "words"], K)
    return out


# ----------------------------------------------------------------------------------------------- TikTok

def tt_sessions(views: list[int], gap_sec: int) -> tuple[list[tuple[int, int, int]], int]:
    """Сессии: перерыв > gap_sec — новая сессия. Возвращает (start, end, n) и оценку длительности последнего видео."""
    if not views:
        return [], 0
    intervals = [b - a for a, b in zip(views, views[1:], strict=False) if 0 < b - a <= gap_sec]
    tail = int(min(max(statistics.median(intervals) if intervals else 15, 5), 60))
    sessions: list[tuple[int, int, int]] = []
    start = prev = views[0]
    cnt = 1
    for t in views[1:]:
        if t - prev > gap_sec:
            sessions.append((start, prev, cnt))
            start, cnt = t, 0
        prev = t
        cnt += 1
    sessions.append((start, prev, cnt))
    return sessions, tail


def build_tt(packet: PacketV1, views_ts: list[int], cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or metrics_config()
    clock = Clock(packet.tz)
    tt = packet.tt
    st = packet.stream
    likes = tt.likes if tt else []
    favs = tt.favorites if tt else []
    logins = tt.logins if tt else []
    stamps = views_ts + likes + favs + logins + list(st.ts)
    days = Days(clock, stamps)
    D = days.n
    sections = applicable_sections(packet)
    want = set(sections)
    P = max(len(packet.participants), 1)

    views = days.zeros()
    hours = [0] * (D * 24)
    for t in views_ts:
        d = days.idx(t)
        views[d] += 1
        hours[d * 24 + clock.hour(t)] += 1

    model: dict[str, Any] = {
        "schema": "report.v1",
        "meta": _meta(packet, cfg, sections),
        "days": {"start": clock.day_str(days.d0), "n": D},
        "series": {"views": [views]},
        "hours": [hours],
        "hours_by_participant": False,
    }
    series = model["series"]

    if "tt.sessions" in want:
        gap = int(cfg["tt_session_gap_min"] * 60)
        sessions, tail = tt_sessions(views_ts, gap)
        screen = days.zeros()
        screen_hours = [0] * (D * 24)
        out_sessions = []
        for s0, s1, cnt in sessions:
            dur = s1 - s0 + tail
            out_sessions.append([s0, s1 + tail, cnt, days.idx(s0)])
            ls = clock.local(s0)
            le = ls + dur
            base = days.d0 * 86400
            while ls < le:
                boundary = (ls // 3600 + 1) * 3600
                chunk = min(le, boundary) - ls
                d = ls // 86400 - days.d0
                if 0 <= d < D:
                    screen[d] += chunk
                    screen_hours[(ls - base) // 3600] += chunk
                ls += chunk
        series["screen_sec"] = [screen]
        model["screen_hours"] = screen_hours
        model["sessions"] = out_sessions
        model["tail_sec"] = tail

    if "tt.activity" in want:
        for name, arr in (("likes", likes), ("favorites", favs), ("logins", logins)):
            s = days.zeros()
            for t in arr:
                s[days.idx(t)] += 1
            series[name] = [s]
        lh = [0] * (D * 24)
        for t in logins:
            lh[days.idx(t) * 24 + clock.hour(t)] += 1
        model["login_hours"] = lh
        model["collections"] = [days.idx(t) for t in (tt.collections if tt else [])]

    if ("tt.chat_deep" in want or "tt.emoji" in want) and st.ts:
        kind_idx = {k: i for i, k in enumerate(packet.kinds)}
        share_k = kind_idx.get("tiktok_share", -1)
        text_k = kind_idx.get("text", -1)
        msgs = [days.zeros() for _ in range(P)]
        shares = [days.zeros() for _ in range(P)]
        texts = [days.zeros() for _ in range(P)]
        for i, t in enumerate(st.ts):
            d, a = days.idx(t), st.author[i]
            msgs[a][d] += 1
            if st.kind[i] == share_k:
                shares[a][d] += 1
            elif st.kind[i] == text_k:
                texts[a][d] += 1
        series["chat_msgs"], series["chat_shares"], series["chat_text"] = msgs, shares, texts
        if "tt.emoji" in want:
            et: Counter = Counter()
            for i, e, c in packet.emoji_hits or []:
                et[(days.idx(st.ts[i]), st.author[i], e)] += c
            model["emoji_text"] = _sparse(et)

    if "tt.content" in want:
        model["content"] = {"status": "beta_pending",
                            "note": "Сводка по авторам и хэштегам появится после проверки oEmbed (фаза 11)."}
    return model


def build_report_model(packet: PacketV1, views_override: list[int] | None = None) -> dict[str, Any]:
    if packet.source == "tg":
        return build_tg(packet)
    views = views_override
    if views is None:
        views = sorted(int(x) for x in ((packet.tt.views or {}).get("ts", []) if packet.tt else []))
    return build_tt(packet, views)
