import json
import re

from app.metrics.packet import PacketV1
from app.metrics.report_model import build_report_model
from app.report.render import render_report
from app.report.sample import sample_html, sample_tg_packet, sample_tt_packet


def _model_from_html(html: str) -> dict:
    m = re.search(r'<script id="report-data" type="application/json">(.*?)</script>', html, re.S)
    assert m
    return json.loads(m.group(1))


def test_tg_sample_model_has_all_sections():
    model = build_report_model(PacketV1.model_validate(sample_tg_packet(days=120)))
    secs = set(model["meta"]["sections"])
    assert {"tg.overview", "tg.rhythm", "tg.dialog", "tg.moments", "tg.laugh_swear", "tg.names"} <= secs
    D = model["days"]["n"]
    assert all(len(row) == D for row in model["series"]["msgs"])
    assert len(model["hours"][0]) == D * 24
    assert model["monologues"] and model["dialogs"]
    top = max(model["monologues"], key=lambda m: m["msgs"])
    assert top["msgs"] >= 2 and top["i1"] > top["i0"]
    assert sum(sum(r) for r in model["firsts"]) > 0
    assert len(model["reply_bins"][0]) == D * 13


def test_tt_sample_sessions_and_screen_time():
    raw, views = sample_tt_packet(days=60)
    model = build_report_model(PacketV1.model_validate(raw), views_override=views)
    assert sum(model["series"]["views"][0]) == len(views)
    assert model["sessions"]
    screen = sum(model["series"]["screen_sec"][0])
    assert screen == sum(model["screen_hours"])
    assert screen > 0


def test_render_is_self_contained_and_escaped():
    packet = sample_tg_packet(days=30)
    packet["title"] = "</script><script>alert(1)</script>"
    html = render_report(build_report_model(PacketV1.model_validate(packet)))
    assert html.count("<script") == 2  # данные + рендерер, внедрения нет
    model = _model_from_html(html)
    assert model["meta"]["title"].startswith("</script>")


def test_sample_pages_render():
    assert "report-data" in sample_html("tg")
    assert "report-data" in sample_html("tt")


def test_invalid_packet_rejected():
    import pytest
    from pydantic import ValidationError

    p = sample_tg_packet(days=10)
    p["stream"]["author"] = p["stream"]["author"][:-1]
    with pytest.raises(ValidationError):
        PacketV1.model_validate(p)
