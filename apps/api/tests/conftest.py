import os
import tempfile

# Настройки должны быть заданы ДО импорта app.* (Settings кешируется).
_TMP = tempfile.mkdtemp(prefix="stats-test-")
os.environ.update({
    "ENV": "local",
    "DEV_LOGIN": "true",
    "DATABASE_URL": f"sqlite+aiosqlite:///{_TMP}/test.db",
    "REPORTS_DIR": f"{_TMP}/reports",
    "ADMIN_EMAILS": "admin@example.com",
    "TG_BOT_TOKEN": "",
    "GOOGLE_SA_JSON": "",
})

import httpx  # noqa: E402
import pytest  # noqa: E402

from app.core.db import SessionLocal, init_models  # noqa: E402

POISON = "POISON_TEXT_42"


@pytest.fixture(scope="session", autouse=True)
def _db():
    import asyncio

    asyncio.run(init_models())


@pytest.fixture
async def session():
    async with SessionLocal() as s:
        yield s


@pytest.fixture
async def client():
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def login(c: httpx.AsyncClient, email: str) -> dict[str, str]:
    r = await c.post("/api/v1/auth/dev-login", json={"email": email})
    assert r.status_code == 200, r.text
    return {"X-CSRF-Token": c.cookies.get("csrf")}
