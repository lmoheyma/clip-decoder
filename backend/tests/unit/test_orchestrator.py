import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from app.api.sse import EventBus
from app.models import (
    FrameAnalysis,
    IngestResult,
    KeyFrame,
    ReferenceCandidate,
    Verdict,
    Confidence,
    VerifiedReference,
)
from app.pipeline.orchestrator import Orchestrator
from app.db import Database, AnalysisStatus


async def test_full_pipeline_emits_events_and_saves(tmp_path: Path):
    db = Database(db_path=tmp_path / "t.sqlite")
    await db.init()
    bus = EventBus()
    img = tmp_path / "shot_00.jpg"
    img.write_bytes(b"x")

    ingestor = MagicMock()
    ingestor.ingest.return_value = IngestResult(
        youtube_id="abc", video_path=tmp_path / "v.mp4",
        title="t", channel="c", duration_s=10.0, captions=[],
    )
    sampler = MagicMock()
    sampler.sample.return_value = [
        KeyFrame(shot_id="shot_00", timestamp_s=1.0, frame_path=img)
    ]
    fa_results = [
        FrameAnalysis(
            timestamp_s=1.0, frame_id="shot_00",
            composition="x", palette=["x"], camera_move="x",
            costume_setting="x", distinctive_features=[],
            raw_description="x", confidence_in_observation=0.8,
        )
    ]
    frame_analyzer = AsyncMock()
    frame_analyzer.analyze.return_value = fa_results
    candidates = [
        ReferenceCandidate(
            timestamp_s=1.0, source_frame_id="shot_00",
            work_title="The Shining", work_creator="Kubrick",
            work_year=1980, work_type="film",
            reasoning="x", raw_confidence=0.8,
        )
    ]
    proposer = AsyncMock()
    proposer.propose.return_value = candidates
    verifier = AsyncMock()
    verifier.verify_all.return_value = [
        VerifiedReference(
            **candidates[0].model_dump(),
            verdict=Verdict.KEEP,
            final_confidence=Confidence.CONFIRMED,
            supporting_elements=["x", "y", "z"],
            wikipedia_url="https://en.wikipedia.org/wiki/The_Shining",
        )
    ]

    received: list = []

    async def collect():
        async for ev in bus.subscribe("abc"):
            received.append(ev)
            if ev.step == "done":
                break

    orch = Orchestrator(
        db=db, bus=bus,
        ingestor=ingestor, sampler=sampler,
        frame_analyzer=frame_analyzer,
        ref_proposer=proposer, verifier=verifier,
    )
    consumer = asyncio.create_task(collect())
    await orch.run("https://www.youtube.com/watch?v=abc")
    await asyncio.wait_for(consumer, timeout=2.0)

    steps = [e.step for e in received]
    assert "ingest" in steps
    assert "shots" in steps
    assert "vision" in steps
    assert "crossref" in steps
    assert "verify" in steps
    assert steps[-1] == "done"
    assert await db.get_status("abc") == AnalysisStatus.DONE
    report = await db.load_report("abc")
    assert report is not None
    assert report.references[0].work_title == "The Shining"
