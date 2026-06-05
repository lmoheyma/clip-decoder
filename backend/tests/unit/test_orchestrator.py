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
from app.pipeline.wikidata_enricher import WikidataEnricher


# ---------------------------------------------------------------------------
# Shared helpers for new tests
# ---------------------------------------------------------------------------

def _make_orchestrator(tmp_path: Path, *, keyframes, fa_results, candidates):
    """Return (orch, bus, received_list) with all mocks wired up."""
    db_mock = AsyncMock()
    db_mock.get_status = AsyncMock(return_value=AnalysisStatus.DONE)
    db_mock.save_report = AsyncMock()
    db_mock.set_status = AsyncMock()

    bus = EventBus()

    ingestor = MagicMock()
    ingestor.ingest.return_value = IngestResult(
        youtube_id="abc",
        video_path=tmp_path / "v.mp4",
        title="My Title",
        channel="My Channel",
        duration_s=120.0,
        captions=[],
    )

    sampler = MagicMock()
    sampler.sample.return_value = keyframes

    # frame_analyzer.analyze must actually call on_frame for each result.
    async def _analyze(kfs, on_frame=None):
        for i, fa in enumerate(fa_results):
            if on_frame:
                await on_frame(fa, i + 1, len(fa_results))
        return fa_results

    frame_analyzer = MagicMock()
    frame_analyzer.analyze = _analyze

    # ref_proposer.propose must actually call on_candidate for each candidate.
    async def _propose(*, title, channel, lyrics_text, frame_analyses, on_candidate=None, on_progress=None):
        for c in candidates:
            if on_candidate:
                await on_candidate(c)
        return candidates

    ref_proposer = MagicMock()
    ref_proposer.propose = _propose

    verifier = AsyncMock()
    verifier.verify_all.return_value = [
        VerifiedReference(
            **candidates[0].model_dump(),
            verdict=Verdict.KEEP,
            final_confidence=Confidence.CONFIRMED,
            supporting_elements=["a"],
            wikipedia_url=None,
            cross_ref_reasoning="cr",
            adversarial_reasoning="ad",
            wikipedia_reasoning="wk",
        )
    ] if candidates else []

    orch = Orchestrator(
        db=db_mock,
        bus=bus,
        ingestor=ingestor,
        sampler=sampler,
        frame_analyzer=frame_analyzer,
        ref_proposer=ref_proposer,
        verifier=verifier,
    )
    return orch, bus


def _default_fixtures(tmp_path: Path):
    img = tmp_path / "shot_00.jpg"
    img.write_bytes(b"x")
    img1 = tmp_path / "shot_01.jpg"
    img1.write_bytes(b"x")

    keyframes = [
        KeyFrame(shot_id="shot_00", timestamp_s=1.0, frame_path=img),
        KeyFrame(shot_id="shot_01", timestamp_s=3.0, frame_path=img1),
    ]
    fa_results = [
        FrameAnalysis(
            timestamp_s=1.0, frame_id="shot_00",
            composition="wide", palette=["red"], palette_hex=["#ff0000"],
            camera_move="static", costume_setting="outdoor",
            distinctive_features=[], raw_description="A wide shot",
            confidence_in_observation=0.9,
        ),
        FrameAnalysis(
            timestamp_s=3.0, frame_id="shot_01",
            composition="close", palette=["blue"], palette_hex=["#0000ff"],
            camera_move="pan", costume_setting="indoor",
            distinctive_features=[], raw_description="A close-up",
            confidence_in_observation=0.8,
        ),
    ]
    candidates = [
        ReferenceCandidate(
            timestamp_s=1.0, source_frame_id="shot_00",
            work_title="The Shining", work_creator="Kubrick",
            work_year=1980, work_type="film",
            reasoning="x", raw_confidence=0.8,
        )
    ]
    return keyframes, fa_results, candidates


async def _run_and_collect(orch: Orchestrator, bus: EventBus) -> list:
    received: list = []

    async def collect():
        async for ev in bus.subscribe("abc"):
            received.append(ev)
            if ev.step == "done":
                break

    consumer = asyncio.create_task(collect())
    await orch.run("https://www.youtube.com/watch?v=abc")
    await asyncio.wait_for(consumer, timeout=2.0)
    return received


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
            cross_ref_reasoning="cr",
            adversarial_reasoning="ad",
            wikipedia_reasoning="wk",
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


# ---------------------------------------------------------------------------
# New TDD tests for Task 3
# ---------------------------------------------------------------------------

async def test_ingest_event_includes_clip_metadata(tmp_path: Path):
    keyframes, fa_results, candidates = _default_fixtures(tmp_path)
    orch, bus = _make_orchestrator(tmp_path, keyframes=keyframes, fa_results=fa_results, candidates=candidates)
    received = await _run_and_collect(orch, bus)

    ingest_events = [e for e in received if e.step == "ingest"]
    assert ingest_events, "No ingest event found"
    payload = ingest_events[0].payload
    assert "title" in payload, f"title missing from ingest payload: {payload}"
    assert "channel" in payload, f"channel missing from ingest payload: {payload}"
    assert "duration_s" in payload, f"duration_s missing from ingest payload: {payload}"
    assert "captions_count" in payload, f"captions_count missing from ingest payload: {payload}"
    assert payload["title"] == "My Title"
    assert payload["channel"] == "My Channel"
    assert payload["duration_s"] == 120.0
    assert payload["captions_count"] == 0


async def test_shots_event_includes_keyframes_list(tmp_path: Path):
    keyframes, fa_results, candidates = _default_fixtures(tmp_path)
    orch, bus = _make_orchestrator(tmp_path, keyframes=keyframes, fa_results=fa_results, candidates=candidates)
    received = await _run_and_collect(orch, bus)

    shots_events = [e for e in received if e.step == "shots"]
    assert shots_events, "No shots event found"
    # The orchestrator emits a "Detecting scenes…" placeholder before the
    # sampler call and then the populated shots event after it; the
    # keyframes payload is on the final one.
    payload = shots_events[-1].payload
    assert "shot_count" in payload
    assert "keyframes" in payload, f"keyframes missing from shots payload: {payload}"
    kfs = payload["keyframes"]
    assert len(kfs) == payload["shot_count"]
    for kf in kfs:
        assert "shot_id" in kf, f"shot_id missing from keyframe: {kf}"
        assert "timestamp_s" in kf, f"timestamp_s missing from keyframe: {kf}"
    assert kfs[0]["shot_id"] == "shot_00"
    assert kfs[1]["shot_id"] == "shot_01"


async def test_vision_frame_events_emitted_per_frame(tmp_path: Path):
    keyframes, fa_results, candidates = _default_fixtures(tmp_path)
    orch, bus = _make_orchestrator(tmp_path, keyframes=keyframes, fa_results=fa_results, candidates=candidates)
    received = await _run_and_collect(orch, bus)

    vf_events = [e for e in received if e.step == "vision_frame"]
    assert len(vf_events) >= 1, "No vision_frame events found"
    assert len(vf_events) == len(fa_results), (
        f"Expected {len(fa_results)} vision_frame events, got {len(vf_events)}"
    )
    for ev in vf_events:
        p = ev.payload
        assert "frame_id" in p, f"frame_id missing: {p}"
        assert "timestamp_s" in p, f"timestamp_s missing: {p}"
        assert "shot_index" in p, f"shot_index missing: {p}"
        assert "total_shots" in p, f"total_shots missing: {p}"
        assert "raw_description" in p, f"raw_description missing: {p}"
        assert "composition" in p, f"composition missing: {p}"
        assert "palette_hex" in p, f"palette_hex missing: {p}"
        assert 1 <= p["shot_index"] <= p["total_shots"]


async def test_orchestrator_emits_enrich_step_and_uses_enriched_refs(tmp_path: Path):
    keyframes, fa_results, candidates = _default_fixtures(tmp_path)

    verifier = AsyncMock()
    verified_ref = VerifiedReference(
        **candidates[0].model_dump(),
        verdict=Verdict.KEEP,
        final_confidence=Confidence.CONFIRMED,
        supporting_elements=["a"],
        wikipedia_url="https://en.wikipedia.org/wiki/The_Shining",
        cross_ref_reasoning="cr",
        adversarial_reasoning="ad",
        wikipedia_reasoning="wk",
    )
    verifier.verify_all.return_value = [verified_ref]

    enricher = AsyncMock()
    enricher.enrich.return_value = [
        verified_ref.model_copy(update={
            "medium": "celluloid",
            "institution": "Warner Bros.",
            "inception_year": 1980,
        })
    ]

    db_mock = AsyncMock()
    db_mock.get_status = AsyncMock(return_value=AnalysisStatus.DONE)
    db_mock.save_report = AsyncMock()
    db_mock.set_status = AsyncMock()
    bus = EventBus()

    ingestor = MagicMock()
    ingestor.ingest.return_value = IngestResult(
        youtube_id="abc", video_path=tmp_path / "v.mp4",
        title="t", channel="c", duration_s=10.0, captions=[],
    )
    sampler = MagicMock()
    sampler.sample.return_value = keyframes

    async def _analyze(kfs, on_frame=None):
        return fa_results
    frame_analyzer = MagicMock()
    frame_analyzer.analyze = _analyze

    async def _propose(*, title, channel, lyrics_text, frame_analyses, on_candidate=None, on_progress=None):
        return candidates
    proposer = MagicMock()
    proposer.propose = _propose

    orch = Orchestrator(
        db=db_mock, bus=bus,
        ingestor=ingestor, sampler=sampler,
        frame_analyzer=frame_analyzer,
        ref_proposer=proposer, verifier=verifier,
        enricher=enricher,
    )

    received: list = []
    async def collect():
        async for ev in bus.subscribe("abc"):
            received.append(ev)
            if ev.step == "done":
                break

    consumer = asyncio.create_task(collect())
    await orch.run("https://www.youtube.com/watch?v=abc")
    await asyncio.wait_for(consumer, timeout=2.0)

    verify_msgs = [e.message for e in received if e.step == "verify"]
    assert any("Enriching" in m for m in verify_msgs), (
        f"No 'Enriching' verify event found: {verify_msgs}"
    )

    saved_report = db_mock.save_report.call_args.args[0]
    assert saved_report.references[0].medium == "celluloid"
    assert saved_report.references[0].institution == "Warner Bros."
    assert saved_report.references[0].inception_year == 1980


async def test_orchestrator_continues_when_enricher_raises(tmp_path: Path):
    keyframes, fa_results, candidates = _default_fixtures(tmp_path)
    verifier = AsyncMock()
    verified_ref = VerifiedReference(
        **candidates[0].model_dump(),
        verdict=Verdict.KEEP,
        final_confidence=Confidence.CONFIRMED,
        supporting_elements=["a"],
        wikipedia_url=None,
        cross_ref_reasoning="cr",
        adversarial_reasoning="ad",
        wikipedia_reasoning="wk",
    )
    verifier.verify_all.return_value = [verified_ref]
    enricher = AsyncMock()
    enricher.enrich.side_effect = RuntimeError("wikidata down")

    db_mock = AsyncMock()
    db_mock.get_status = AsyncMock(return_value=AnalysisStatus.DONE)
    db_mock.save_report = AsyncMock()
    db_mock.set_status = AsyncMock()
    bus = EventBus()
    ingestor = MagicMock()
    ingestor.ingest.return_value = IngestResult(
        youtube_id="abc", video_path=tmp_path / "v.mp4",
        title="t", channel="c", duration_s=10.0, captions=[],
    )
    sampler = MagicMock(); sampler.sample.return_value = keyframes
    async def _analyze(kfs, on_frame=None): return fa_results
    frame_analyzer = MagicMock(); frame_analyzer.analyze = _analyze
    async def _propose(**kw): return candidates
    proposer = MagicMock(); proposer.propose = _propose

    orch = Orchestrator(
        db=db_mock, bus=bus,
        ingestor=ingestor, sampler=sampler,
        frame_analyzer=frame_analyzer,
        ref_proposer=proposer, verifier=verifier,
        enricher=enricher,
    )

    async def collect():
        async for ev in bus.subscribe("abc"):
            if ev.step == "done":
                return
    consumer = asyncio.create_task(collect())
    await orch.run("https://www.youtube.com/watch?v=abc")
    await asyncio.wait_for(consumer, timeout=2.0)

    saved_report = db_mock.save_report.call_args.args[0]
    # graceful degrade: references saved with unrelated fields intact
    assert saved_report.references[0].medium is None


async def test_orchestrator_stores_lyrics_links(tmp_path: Path):
    from app.models import Caption, LyricLink

    keyframes, fa_results, candidates = _default_fixtures(tmp_path)

    verifier = AsyncMock()
    verifier.verify_all.return_value = [
        VerifiedReference(
            **candidates[0].model_dump(),
            verdict=Verdict.KEEP,
            final_confidence=Confidence.CONFIRMED,
            supporting_elements=["a"],
            wikipedia_url=None,
            cross_ref_reasoning="cr",
            adversarial_reasoning="ad",
            wikipedia_reasoning="wk",
        )
    ]

    lyrics_linker = AsyncMock()
    lyrics_linker.link.return_value = [
        LyricLink(
            lyric_timestamp_s=1.0, lyric="gold on my mind",
            frame_id="shot_00", frame_timestamp_s=1.0,
            relation="motif", note="palette warms to gold",
        )
    ]

    db_mock = AsyncMock()
    db_mock.get_status = AsyncMock(return_value=AnalysisStatus.DONE)
    db_mock.save_report = AsyncMock()
    db_mock.set_status = AsyncMock()
    bus = EventBus()

    ingestor = MagicMock()
    ingestor.ingest.return_value = IngestResult(
        youtube_id="abc", video_path=tmp_path / "v.mp4",
        title="t", channel="c", duration_s=10.0,
        captions=[Caption(start_s=1.0, end_s=2.0, text="gold on my mind")],
    )
    sampler = MagicMock()
    sampler.sample.return_value = keyframes

    async def _analyze(kfs, on_frame=None):
        return fa_results
    frame_analyzer = MagicMock()
    frame_analyzer.analyze = _analyze

    async def _propose(**kw):
        return candidates
    proposer = MagicMock()
    proposer.propose = _propose

    orch = Orchestrator(
        db=db_mock, bus=bus,
        ingestor=ingestor, sampler=sampler,
        frame_analyzer=frame_analyzer,
        ref_proposer=proposer, verifier=verifier,
        lyrics_linker=lyrics_linker,
    )

    async def collect():
        async for ev in bus.subscribe("abc"):
            if ev.step == "done":
                return
    consumer = asyncio.create_task(collect())
    await orch.run("https://www.youtube.com/watch?v=abc")
    await asyncio.wait_for(consumer, timeout=2.0)

    lyrics_linker.link.assert_awaited_once()
    saved_report = db_mock.save_report.call_args.args[0]
    assert saved_report.lyrics_links[0].relation == "motif"
