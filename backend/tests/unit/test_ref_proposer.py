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
    assert len(out) >= 1
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


async def test_propose_runs_two_passes_with_types_covered():
    nim = AsyncMock()
    # First call (pass 1) returns one film candidate; second call (pass 2)
    # should be told types_covered=film and return a painting candidate.
    nim.complete_text.side_effect = [
        {
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
        },
        {
            "candidates": [
                {
                    "timestamp_s": 30.0,
                    "source_frame_id": "shot_07",
                    "work_title": "Liberty Leading the People",
                    "work_creator": "Eugène Delacroix",
                    "work_year": 1830,
                    "work_type": "painting",
                    "reasoning": "central raised figure + flag + smoke",
                    "raw_confidence": 0.7,
                }
            ]
        },
    ]
    rp = RefProposer(nim_client=nim, model="m")
    out = await rp.propose(
        title="x", channel="y", lyrics_text="",
        frame_analyses=[_fa("shot_03", 12.5), _fa("shot_07", 30.0)],
    )
    # Both calls happened, in order
    assert nim.complete_text.await_count == 2
    # Pass 2 received types_covered="film" inside its prompt
    pass2_kwargs = nim.complete_text.await_args_list[1].kwargs
    pass2_prompt = pass2_kwargs["messages"][0]["content"]
    assert "Types already proposed by the previous pass: film" in pass2_prompt
    # Both candidates surface
    titles = sorted(c.work_title for c in out)
    assert titles == ["Liberty Leading the People", "The Shining"]
