from unittest.mock import AsyncMock
from app.models import FrameAnalysis
from app.pipeline.ref_proposer import RefProposer


def _fa(frame_id: str, ts: float) -> FrameAnalysis:
    return FrameAnalysis(
        timestamp_s=ts,
        frame_id=frame_id,
        composition="centered symmetrical corridor",
        palette=["red", "black"],
        camera_move="slow tracking forward",
        costume_setting="man in white shirt, hotel hallway",
        distinctive_features=["one-point perspective", "neon"],
        raw_description="A long red corridor.",
        confidence_in_observation=0.9,
    )


async def test_proposes_named_candidates():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "candidates": [
            {
                "timestamp_s": 12.5,
                "source_frame_id": "shot_03",
                "work_title": "The Shining",
                "work_creator": "Stanley Kubrick",
                "work_year": 1980,
                "work_type": "film",
                "reasoning": "symmetry + corridor + slow track",
                "raw_confidence": 0.82,
            }
        ]
    }
    rp = RefProposer(nim_client=nim, model="m")
    out = await rp.propose(
        title="x",
        channel="y",
        lyrics_text="",
        frame_analyses=[_fa("shot_03", 12.5)],
    )
    assert len(out) == 1
    assert out[0].work_title == "The Shining"


async def test_drops_candidates_with_empty_title():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "candidates": [
            {
                "timestamp_s": 1.0,
                "source_frame_id": "shot_00",
                "work_title": "",
                "work_creator": "Someone",
                "work_type": "film",
                "reasoning": "x",
                "raw_confidence": 0.5,
            }
        ]
    }
    rp = RefProposer(nim_client=nim, model="m")
    out = await rp.propose(
        title="x", channel="y", lyrics_text="", frame_analyses=[_fa("shot_00", 1.0)]
    )
    assert out == []


async def test_empty_candidates_list_is_ok():
    nim = AsyncMock()
    nim.complete_text.return_value = {"candidates": []}
    rp = RefProposer(nim_client=nim, model="m")
    out = await rp.propose(
        title="x", channel="y", lyrics_text="", frame_analyses=[_fa("shot_00", 0.0)]
    )
    assert out == []
