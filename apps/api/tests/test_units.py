import uuid

from app.billing.promo import ALPHABET, generate_code
from app.core.logging import scrub_pii
from app.core.security import user_ref_for, verify_telegram_login
from app.dictionaries.service import build_client_dictionaries, load_raw_seed, mask_word, name_forms, validate
from app.metrics.clock import Clock
from app.metrics.report_model import tt_sessions

from .conftest import POISON


def test_scrub_removes_texts_and_emails():
    out = scrub_pii(None, "info", {"event": "x", "text": POISON, "note": "пишите на a.b@mail.ru",
                                   "data": {"content": POISON, "n": 3}, "long": "я" * 500})
    assert POISON not in str(out)
    assert "[email]" in out["note"]
    assert out["data"]["n"] == 3
    assert len(out["long"]) <= 201


def test_user_ref_is_stable_and_opaque():
    uid = uuid.uuid4()
    assert user_ref_for(uid) == user_ref_for(uid)
    assert user_ref_for(uid).startswith("u_") and str(uid) not in user_ref_for(uid)


def test_telegram_login_signature():
    import hashlib
    import hmac
    import time

    token = "123:ABC"
    data = {"id": "42", "first_name": "Тест", "auth_date": str(int(time.time()))}
    check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    data["hash"] = hmac.new(hashlib.sha256(token.encode()).digest(), check.encode(), hashlib.sha256).hexdigest()
    assert verify_telegram_login(data, token)
    data["first_name"] = "Подмена"
    assert not verify_telegram_login(data, token)


def test_promo_code_format():
    code = generate_code()
    assert len(code) == 9 and code[4] == "-"
    assert all(ch in ALPHABET for ch in code.replace("-", ""))


def test_clock_timezones():
    c = Clock("Asia/Novosibirsk")
    ts = 1735848600  # 2025-01-02 20:10 UTC
    assert c.hour(ts) == 3
    assert Clock.day_str(c.day(ts)) == "2025-01-03"
    assert Clock.weekday(0) == 3


def test_tt_sessions_gap_and_tail():
    views = [0, 30, 60, 90, 1000, 1030]  # перерыв 910 с > 600 → две сессии
    sessions, tail = tt_sessions(views, 600)
    assert [(s[0], s[1], s[2]) for s in sessions] == [(0, 90, 4), (1000, 1030, 2)]
    assert tail == 30


def test_seed_dictionaries_are_valid_and_build():
    raw = load_raw_seed()
    assert validate(raw) == []
    d = build_client_dictionaries(raw, custom_names=["Котя"])
    assert d["names"]["forms"].get("саше", "").startswith("n:")
    assert "котю" in d["names"]["forms"]
    assert "вера" not in d["names"]["forms"]  # неоднозначное имя исключено
    assert d["version"]


def test_bad_pattern_is_rejected():
    raw = {"swear_patterns": [{"id": "x", "pattern": "бля", "display": "б*я"}], "safe_words": ["корабля"],
           "swear_exceptions": [], "laugh": []}
    errors = validate(raw)
    assert errors and "корабля" in errors[0]


def test_name_forms_and_mask():
    forms = name_forms("Саша")
    assert {"саша", "саши", "саше", "сашу", "сашей"} <= forms
    assert mask_word("пример") == "п****р"
