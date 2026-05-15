import asyncio
from pathlib import Path
from unittest.mock import AsyncMock
import pytest
from httpx import ASGITransport, AsyncClient
from app.api.sse import EventBus
from app.db import AnalysisStatus, Database
from app.main import build_app
from app.models import (
    Report, VerifiedReference, Verdict, Confidence,
)


@pytest.fixture
async def client(tmp_path: Path):
    db = Database(db_path=tmp_path / "t.sqlite")
    await db.init()
    bus = EventBus()
    orch_run = AsyncMock()  # no-op orchestrator stand-in
    app = build_app(db=db, bus=bus, run_pipeline=orch_run)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c, db, orch_run, bus


async def test_analyze_returns_running_for_new_url(client):
    c, db, orch_run, bus = client
    r = await c.post(
        "/api/analyze",
        json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["youtube_id"] == "dQw4w9WgXcQ"
    assert body["status"] == "running"
    assert body["status_stream_url"].endswith("/api/stream/dQw4w9WgXcQ")
    # Ensure orchestrator was scheduled
    await asyncio.sleep(0)
    assert orch_run.await_count >= 1


async def test_analyze_creates_pending_row_before_returning(client):
    # Regression: /api/analyze used to schedule the orchestrator and return
    # immediately, without writing any DB row. The frontend redirects to
    # /report/{id} the instant the response lands and probes /api/status —
    # if the orchestrator hadn't yet awaited set_status(RUNNING), the probe
    # saw no row and the UI flipped to "No report with that id." Fix: the
    # row must exist (as PENDING) before /analyze returns.
    c, db, orch_run, bus = client
    r = await c.post(
        "/api/analyze",
        json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
    )
    assert r.status_code == 200
    s = await c.get("/api/status/dQw4w9WgXcQ")
    assert s.status_code == 200
    assert s.json()["status"] in ("pending", "running")


async def test_analyze_returns_cached_when_done(client):
    c, db, orch_run, bus = client
    report = Report(
        youtube_id="dQw4w9WgXcQ",
        title="t", channel="c", duration_s=1.0,
        references=[], frame_analyses=[],
    )
    await db.save_report(report, status=AnalysisStatus.DONE)
    r = await c.post(
        "/api/analyze",
        json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
    )
    assert r.json()["status"] == "cached"


async def test_get_report_404_when_missing(client):
    c, *_ = client
    r = await c.get("/api/report/missing")
    assert r.status_code == 404


async def test_get_report_returns_payload(client):
    c, db, *_ = client
    report = Report(
        youtube_id="x", title="t", channel="c", duration_s=1.0,
        references=[
            VerifiedReference(
                timestamp_s=1.0, source_frame_id="shot_00",
                work_title="W", work_creator="C", work_type="film",
                reasoning="r", raw_confidence=0.5,
                verdict=Verdict.KEEP, final_confidence=Confidence.CONFIRMED,
                supporting_elements=[],
                cross_ref_reasoning="matched",
                adversarial_reasoning="none",
                wikipedia_reasoning="aligned",
            )
        ],
        frame_analyses=[],
    )
    await db.save_report(report, status=AnalysisStatus.DONE)
    r = await c.get("/api/report/x")
    assert r.status_code == 200
    assert r.json()["title"] == "t"
    assert r.json()["references"][0]["work_title"] == "W"
