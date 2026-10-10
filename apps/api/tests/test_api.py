import gzip
import json

from app.report.sample import sample_tg_packet

from .conftest import POISON, login


async def test_me_requires_login(client):
    r = await client.get("/api/v1/me")
    assert r.status_code == 401


async def test_run_without_balance_is_402(client):
    h = await login(client, "nobody@example.com")
    r = await client.post("/api/v1/runs", headers=h, json={"source": "tg", "chat_kind": "personal", "chat_key": "c1",
                                                          "sections": ["tg.rhythm"]})
    assert r.status_code == 402


async def test_free_only_sections_are_rejected(client):
    h = await login(client, "free@example.com")
    r = await client.post("/api/v1/runs", headers=h, json={"source": "tg", "chat_kind": "personal", "chat_key": "c1",
                                                          "sections": ["tg.overview"]})
    assert r.status_code == 400


async def test_csrf_required(client):
    await login(client, "csrf@example.com")
    r = await client.post("/api/v1/runs", json={"source": "tg", "chat_kind": "personal", "chat_key": "c", "sections": ["tg.rhythm"]})
    assert r.status_code == 403


async def test_full_flow_promo_run_report_rerun(client):
    # админ создаёт персональный промокод
    admin_h = await login(client, "admin@example.com")
    me = (await client.get("/api/v1/me")).json()
    assert me["role"] == "admin"
    await login(client, "user@example.com")  # создаём пользователя
    admin_h = await login(client, "admin@example.com")
    r = await client.post("/api/v1/admin/promos", headers=admin_h, json={
        "kind": "runs", "value": 1, "scope": "personal", "user_email": "user@example.com"})
    assert r.status_code == 200, r.text
    code = r.json()["codes"][0]

    # пользователь применяет промокод
    h = await login(client, "user@example.com")
    r = await client.post("/api/v1/promo/redeem", headers=h, json={"code": code.lower()})
    assert r.status_code == 200 and r.json()["balance"] == 1
    r = await client.post("/api/v1/promo/redeem", headers=h, json={"code": code})
    assert r.status_code == 400  # одноразовый

    # разбор
    sections = ["tg.rhythm", "tg.dialog", "tg.moments", "tg.names"]
    r = await client.post("/api/v1/runs", headers=h, json={"source": "tg", "chat_kind": "personal", "chat_key": "chat-42",
                                                          "sections": sections, "custom_names": ["Котя"]})
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["charge"] == "paid" and run["balance"] == 0 and run["dictionaries"]["names"]["forms"]

    packet = sample_tg_packet(days=40)
    packet["sections"] = sections
    body = gzip.compress(json.dumps(packet).encode())
    r = await client.post(f"/api/v1/runs/{run['run_id']}/packet", headers={**h, "Content-Encoding": "gzip"}, content=body)
    assert r.status_code == 202, r.text
    st = (await client.get(f"/api/v1/runs/{run['run_id']}")).json()
    assert st["status"] == "done", st
    html = (await client.get(f"/api/v1/runs/{run['run_id']}/report.html")).text
    assert "report-data" in html and POISON not in html

    # повтор того же чата — бесплатно
    r = await client.post("/api/v1/runs", headers=h, json={"source": "tg", "chat_kind": "personal", "chat_key": "chat-42",
                                                          "sections": sections})
    assert r.status_code == 200 and r.json()["charge"] == "free_rerun"

    # другой чат — нет разборов
    r = await client.post("/api/v1/runs", headers=h, json={"source": "tg", "chat_kind": "personal", "chat_key": "other",
                                                          "sections": sections})
    assert r.status_code == 402


async def test_invalid_packet_releases_run(client):
    admin_h = await login(client, "admin@example.com")
    await login(client, "u2@example.com")
    admin_h = await login(client, "admin@example.com")
    users = (await client.get("/api/v1/admin/users", params={"q": "u2@"})).json()
    await client.post(f"/api/v1/admin/users/{users[0]['id']}/grant", headers=admin_h, json={"runs": 1, "reason": "тест"})
    h = await login(client, "u2@example.com")
    run = (await client.post("/api/v1/runs", headers=h, json={"source": "tg", "chat_kind": "personal", "chat_key": "x",
                                                              "sections": ["tg.rhythm"]})).json()
    assert run["balance"] == 0
    r = await client.post(f"/api/v1/runs/{run['run_id']}/packet", headers=h, content=b'{"schema": "broken"}')
    assert r.status_code == 422
    assert (await client.get("/api/v1/me")).json()["balance"] == 1


async def test_mock_payment_credits_once(client):
    h = await login(client, "buyer@example.com")
    r = await client.post("/api/v1/payments/yookassa", headers=h, json={"product_id": "pack5"})
    assert r.status_code == 200 and r.json()["mock"]
    pid = r.json()["confirmation_url"].split("mock_payment=")[1]
    r1 = await client.post(f"/api/v1/payments/mock/{pid}/succeed", headers=h)
    r2 = await client.post(f"/api/v1/payments/mock/{pid}/succeed", headers=h)
    assert r1.json()["balance"] == 5 and r2.json()["balance"] == 5


async def test_tiktok_history_needs_consent_and_dedupes(client):
    h = await login(client, "tt@example.com")
    body = {"files": [{"file_hash": "a", "ts": [1, 2, 2], "video": ["v1", "v1", "v2"]}]}
    r = await client.post("/api/v1/tiktok/history", headers=h, json=body)
    assert r.status_code == 409
    await client.patch("/api/v1/me/settings", headers=h, json={"consents": {"store_tt_history": True}})
    r = await client.post("/api/v1/tiktok/history", headers=h, json=body)
    assert r.json()["total"] == 3
    body2 = {"files": [{"file_hash": "b", "ts": [2, 5], "video": ["v1", "v9"]}]}
    r = await client.post("/api/v1/tiktok/history", headers=h, json=body2)
    assert r.json() == {**r.json(), "added": 1, "duplicates": 1, "total": 4}


async def test_sample_report_public(client):
    r = await client.get("/api/v1/sample/tt")
    assert r.status_code == 200 and "TikTok" in r.text
