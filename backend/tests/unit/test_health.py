import pytest
from pathlib import Path
from unittest.mock import AsyncMock
from httpx import ASGITransport, AsyncClient
from app.api.sse import EventBus
from app.db import Database
from app.main import build_app


@pytest.fixture
async def client(tmp_path: Path):
    db = Database(db_path=tmp_path / "t.sqlite")
    await db.init()
    app = build_app(db=db, bus=EventBus(), run_pipeline=AsyncMock())
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def test_health_returns_ok(client):
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
