import pytest
from pydantic import ValidationError
from app.models import (
    KeyFrame,
    FrameAnalysis,
    ReferenceCandidate,
    VerifiedReference,
    Verdict,
    Confidence,
    Report,
    PipelineEvent,
)


def test_frame_analysis_round_trip():
    fa = FrameAnalysis(
        timestamp_s=12.5,
        frame_id="shot_03",
        composition="centered symmetrical corridor",
        palette=["red", "black"],
        camera_move="slow tracking forward",
        costume_setting="white shirt, hotel hallway",
        distinctive_features=["one-point perspective", "neon"],
        raw_description="A long red corridor seen head-on...",
        confidence_in_observation=0.9,
    )
    dumped = fa.model_dump()
    assert dumped["timestamp_s"] == 12.5
    assert FrameAnalysis(**dumped) == fa


def test_reference_candidate_requires_named_work():
    with pytest.raises(ValidationError):
        ReferenceCandidate(
            timestamp_s=10.0,
            source_frame_id="shot_01",
            work_title="",  # empty -> reject
            work_creator="Stanley Kubrick",
            work_type="film",
            reasoning="x",
            raw_confidence=0.5,
        )


def test_verified_reference_verdict_enum():
    vr = VerifiedReference(
        timestamp_s=10.0,
        source_frame_id="shot_01",
        work_title="The Shining",
        work_creator="Stanley Kubrick",
        work_year=1980,
        work_type="film",
        reasoning="symmetrical corridor + slow tracking",
        raw_confidence=0.8,
        verdict=Verdict.KEEP,
        final_confidence=Confidence.CONFIRMED,
        supporting_elements=["symmetry", "corridor", "slow track"],
        wikipedia_url="https://en.wikipedia.org/wiki/The_Shining_(film)",
        cross_ref_reasoning="match",
        adversarial_reasoning="none",
        wikipedia_reasoning="aligned",
    )
    assert vr.verdict == Verdict.KEEP


def test_pipeline_event_serializable():
    e = PipelineEvent(step="vision", message="frame 5 of 12", progress=0.42)
    assert e.model_dump_json().startswith("{")
