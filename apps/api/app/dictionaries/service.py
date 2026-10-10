"""Словари мата, имён, смеха, стоп-слов.

Источник истины — Google-таблица автора на Диске (листы swear_patterns, swear_words, swear_exceptions, names,
laugh, stopwords). Синхронизация — sync_from_sheet() (фаза 10). Пока таблица не подключена — используется
резервная копия dictionaries/seed/ из репозитория. Формат — docs/16-google-integrations.md.

Браузер получает словари только вместе с оплаченным разбором (ADR-003).
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import settings


def _norm(s: str) -> str:
    return s.strip().lower().replace("ё", "е")


def mask_word(w: str) -> str:
    w = w.strip()
    if len(w) <= 2:
        return w[0] + "*" if w else w
    return w[0] + "*" * (len(w) - 2) + w[-1]


@lru_cache
def _morph():
    try:
        import pymorphy3  # type: ignore

        return pymorphy3.MorphAnalyzer()
    except Exception:  # noqa: BLE001 — нет словарей pymorphy — работаем на эвристике
        return None


def _naive_forms(word: str) -> set[str]:
    w = _norm(word)
    out = {w}
    if w.endswith("ия"):
        st = w[:-2]
        out |= {st + e for e in ("ия", "ии", "ию", "ией", "иею")}
    elif w.endswith("а"):
        st = w[:-1]
        out |= {st + e for e in ("а", "ы", "и", "е", "у", "ой", "ою")}
        if st and st[-1] in "жшчщц":
            out |= {st + "ей", st + "ею"}
    elif w.endswith("я"):
        st = w[:-1]
        out |= {st + e for e in ("я", "и", "е", "ю", "ей", "ею")}
    elif w.endswith("й"):
        st = w[:-1]
        out |= {st + e for e in ("й", "я", "ю", "ем", "е")}
    elif w.endswith("ь"):
        st = w[:-1]
        out |= {st + e for e in ("ь", "я", "ю", "ем", "е", "и", "ью")}
    else:
        out |= {w + e for e in ("а", "у", "ом", "ем", "е")}
    return out


def name_forms(word: str) -> set[str]:
    """Все падежные формы имени: pymorphy3 (если доступен) + эвристика для уменьшительных."""
    forms = _naive_forms(word)
    morph = _morph()
    if morph is not None:
        for p in morph.parse(word)[:3]:
            if {"Name", "Surn", "Patr"} & set(p.tag.grammemes) or p.tag.POS == "NOUN":
                forms |= {_norm(f.word) for f in p.lexeme if "plur" not in f.tag}
                break
    return {f for f in forms if len(f) >= 2}


def _read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return [row for row in csv.DictReader(f) if any(v and v.strip() for v in row.values())]


def _read_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return [ln.strip() for ln in f if ln.strip() and not ln.startswith("#")]


def load_raw_seed(seed_dir: str | None = None) -> dict[str, Any]:
    d = Path(seed_dir or settings.dictionaries_seed_dir)
    return {
        "swear_patterns": _read_csv(d / "swear_patterns.csv"),
        "swear_words": _read_lines(d / "swear_words.txt"),
        "swear_exceptions": _read_lines(d / "swear_exceptions.txt"),
        "names": _read_csv(d / "names.csv"),
        "laugh": [r["pattern"] for r in _read_csv(d / "laugh.csv") if r.get("enabled", "true").lower() != "false"],
        "stopwords": _read_lines(d / "stopwords.txt"),
        "safe_words": _read_lines(d / "safe_words.txt"),
    }


def validate(raw: dict[str, Any]) -> list[str]:
    """Ошибки словаря. Невалидная версия не активируется (docs/16)."""
    errors: list[str] = []
    safe = [_norm(w) for w in raw.get("safe_words", [])]
    exceptions = {_norm(w) for w in raw.get("swear_exceptions", [])}
    ids = set()
    for row in raw.get("swear_patterns", []):
        pid = row.get("id", "").strip()
        if not pid or pid in ids:
            errors.append(f"swear_patterns: пустой или повторный id «{pid}»")
        ids.add(pid)
        try:
            rx = re.compile(row.get("pattern", ""))
        except re.error as e:
            errors.append(f"swear_patterns {pid}: регулярка не компилируется ({e})")
            continue
        hits = [w for w in safe if w not in exceptions and rx.search(w)]
        if hits:
            errors.append(f"swear_patterns {pid}: ловит безобидные слова: {', '.join(hits[:5])}")
    for p in raw.get("laugh", []):
        try:
            re.compile(p)
        except re.error as e:
            errors.append(f"laugh: «{p}» не компилируется ({e})")
    return errors


def build_client_dictionaries(raw: dict[str, Any], custom_names: list[str] | None = None) -> dict[str, Any]:
    patterns = [
        {"id": "r:" + r["id"].strip(), "re": r["pattern"].strip(), "display": r.get("display") or r["id"]}
        for r in raw.get("swear_patterns", []) if r.get("enabled", "true").lower() != "false"
    ]
    compiled = [(p["id"], re.compile(p["re"])) for p in patterns]
    words: dict[str, str] = {}
    labels: dict[str, str] = {p["id"]: p["display"] for p in patterns}
    for w in raw.get("swear_words", []):
        nw = _norm(w)
        gid = next((pid for pid, rx in compiled if rx.search(nw)), None)
        if gid is None:
            gid = "w:" + nw
            labels[gid] = mask_word(nw)
        words[nw] = gid

    forms: dict[str, str] = {}
    name_labels: dict[str, str] = {}
    for row in raw.get("names", []):
        if row.get("enabled", "true").lower() == "false":
            continue
        nid = "n:" + row["id"].strip()
        base = row["base"].strip()
        name_labels[nid] = base
        # ambiguous: «Вера» — исключить слово целиком (все формы); «=кости» — исключить только эту форму.
        amb = [x.strip() for x in (row.get("ambiguous") or "").split(",") if x.strip()]
        skip_words = {_norm(x) for x in amb if not x.startswith("=")}
        skip_forms = {_norm(x[1:]) for x in amb if x.startswith("=")}
        variants = [base] + [v.strip() for v in (row.get("variants") or "").split(",") if v.strip()]
        for v in variants:
            if _norm(v) in skip_words:
                continue
            for f in name_forms(v) - skip_forms:
                forms.setdefault(f, nid)
    for i, name in enumerate(custom_names or []):
        name = name.strip()
        if not name:
            continue
        nid = f"c:{i}"
        name_labels[nid] = name[:40]
        for f in name_forms(name):
            forms[f] = nid  # свои имена пользователя важнее словаря

    payload = {
        "swear": {"words": words, "patterns": [{"id": p["id"], "re": p["re"]} for p in patterns],
                  "exceptions": sorted({_norm(w) for w in raw.get("swear_exceptions", [])}), "labels": labels},
        "names": {"forms": forms, "labels": name_labels},
        "laugh": raw.get("laugh", []),
        "stopwords": sorted({_norm(w) for w in raw.get("stopwords", [])}),
    }
    payload["version"] = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]
    return payload


@lru_cache
def _seed_cached() -> dict[str, Any]:
    return load_raw_seed()


def active_raw() -> dict[str, Any]:
    """Сейчас — seed. После фазы 10 — активная валидная версия из таблицы dictionary_versions."""
    return _seed_cached()


async def sync_from_sheet() -> dict[str, Any]:
    """Фаза 10: прочитать Google-таблицу словарей сервисным аккаунтом, провалидировать, сохранить версию."""
    raise NotImplementedError("Синхронизация словарей с Google Sheets — фаза 10 (docs/ROADMAP.md)")
