import shutil
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.routes import build_router
from app.api.sse import EventBus
from app.db import Database
from app.settings import settings
from fastapi import FastAPI


_FIXTURE_JPG = Path(__file__).parent.parent / "fixtures" / "red_solid.jpg"


@pytest.fixture
async def app_with_frame(tmp_path, monkeypatch):
    """Build a minimal app, point settings.data_dir at tmp_path, and drop a fixture frame in the expected location."""
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    yt = "dQw4w9WgXcQ"
    frame_dir = tmp_path / "frames" / yt
    frame_dir.mkdir(parents=True)
    shutil.copy(_FIXTURE_JPG, frame_dir / "shot_001.jpg")

    db = Database(db_path=tmp_path / "test.sqlite")
    await db.init()
    bus = EventBus()

    async def _noop(_url: str) -> None:
        pass

    fastapi_app = FastAPI()
    fastapi_app.include_router(build_router(db=db, bus=bus, run_pipeline=_noop))
    return fastapi_app, yt


@pytest.fixture
async def client(app_with_frame):
    app, yt = app_with_frame
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c, yt


async def test_get_frame_returns_200_with_correct_mime(client):
    c, yt = client
    r = await c.get(f"/api/frames/{yt}/shot_001")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert "max-age=31536000" in r.headers.get("cache-control", "")


async def test_get_frame_404_on_missing(client):
    c, yt = client
    r = await c.get(f"/api/frames/{yt}/shot_999")
    assert r.status_code == 404


async def test_get_frame_400_on_invalid_frame_id(client):
    c, yt = client
    r = await c.get(f"/api/frames/{yt}/bogus_id")
    assert r.status_code == 400


async def test_get_frame_400_on_invalid_youtube_id(client):
    c, _ = client
    r = await c.get("/api/frames/short/shot_001")
    assert r.status_code == 400
