import pytest
from pathlib import Path
from app.db import Database, AnalysisStatus
from app.models import Report, VerifiedReference, FrameAnalysis, Verdict, Confidence


@pytest.fixture
async def db(tmp_path: Path) -> Database:
    d = Database(db_path=tmp_path / "test.sqlite")
    await d.init()
    return d


@pytest.fixture
def sample_report() -> Report:
    return Report(
        youtube_id="abc123",
        title="Test Clip",
        channel="Tester",
        duration_s=240.0,
        references=[
            VerifiedReference(
                timestamp_s=10.0,
                source_frame_id="shot_01",
                work_title="The Shining",
                work_creator="Stanley Kubrick",
                work_year=1980,
                work_type="film",
                reasoning="symmetry",
                raw_confidence=0.8,
                verdict=Verdict.KEEP,
                final_confidence=Confidence.CONFIRMED,
                supporting_elements=["symmetry"],
            )
        ],
        frame_analyses=[],
    )


async def test_save_and_load_report(db: Database, sample_report: Report):
    await db.save_report(sample_report, status=AnalysisStatus.DONE)
    loaded = await db.load_report("abc123")
    assert loaded is not None
    assert loaded.youtube_id == "abc123"
    assert loaded.references[0].work_title == "The Shining"


async def test_load_missing_returns_none(db: Database):
    assert await db.load_report("nope") is None


async def test_status_lifecycle(db: Database, sample_report: Report):
    await db.set_status("abc123", AnalysisStatus.RUNNING)
    assert await db.get_status("abc123") == AnalysisStatus.RUNNING
    await db.save_report(sample_report, status=AnalysisStatus.DONE)
    assert await db.get_status("abc123") == AnalysisStatus.DONE


async def test_flag_reference(db: Database, sample_report: Report):
    await db.save_report(sample_report, status=AnalysisStatus.DONE)
    await db.flag_reference("abc123", ref_index=0, reason="wrong")
    flags = await db.list_flags("abc123")
    assert len(flags) == 1
    assert flags[0]["ref_index"] == 0
