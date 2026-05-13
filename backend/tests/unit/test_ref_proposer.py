from unittest.mock import AsyncMock
from app.models import FrameAnalysis, ReferenceCandidate
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


async def test_merge_dedups_case_insensitive_pass1_wins():
    nim = AsyncMock()
    pass1_payload = {
        "candidates": [
            {
                "timestamp_s": 12.5,
                "source_frame_id": "shot_03",
                "work_title": "Suspiria",
                "work_creator": "Dario Argento",
                "work_year": 1977,
                "work_type": "film",
                "reasoning": "red light + symmetric corridor + ornate set",
                "raw_confidence": 0.85,
            }
        ]
    }
    # Pass 2 returns the same work in different case — must be dedup'd.
    pass2_payload = {
        "candidates": [
            {
                "timestamp_s": 50.0,
                "source_frame_id": "shot_10",
                "work_title": "SUSPIRIA",
                "work_creator": "dario argento",
                "work_year": 1977,
                "work_type": "film",
                "reasoning": "red palette + dance studio + neon",
                "raw_confidence": 0.4,
            }
        ]
    }
    nim.complete_text.side_effect = [pass1_payload, pass2_payload]
    rp = RefProposer(nim_client=nim, model="m")
    out = await rp.propose(
        title="x", channel="y", lyrics_text="",
        frame_analyses=[_fa("shot_03", 12.5)],
    )
    assert len(out) == 1
    # Pass 1 wins: original casing, original timestamp, original confidence.
    assert out[0].work_title == "Suspiria"
    assert out[0].work_creator == "Dario Argento"
    assert out[0].timestamp_s == 12.5
    assert out[0].raw_confidence == 0.85


async def test_pass2_failure_returns_pass1_only(caplog):
    import httpx
    nim = AsyncMock()
    nim.complete_text.side_effect = [
        {
            "candidates": [
                {
                    "timestamp_s": 1.0,
                    "source_frame_id": "shot_00",
                    "work_title": "Solaris",
                    "work_creator": "Andrei Tarkovsky",
                    "work_year": 1972,
                    "work_type": "film",
                    "reasoning": "long static interior + reflective surface + somber palette",
                    "raw_confidence": 0.7,
                }
            ]
        },
        httpx.HTTPStatusError(
            "502", request=httpx.Request("POST", "https://x"),
            response=httpx.Response(502),
        ),
    ]
    rp = RefProposer(nim_client=nim, model="m")
    with caplog.at_level("WARNING", logger="app.pipeline.ref_proposer"):
        out = await rp.propose(
            title="x", channel="y", lyrics_text="",
            frame_analyses=[_fa("shot_00", 1.0)],
        )
    assert len(out) == 1
    assert out[0].work_title == "Solaris"
    assert any("pass 2 failed" in rec.message for rec in caplog.records)


async def test_pass1_empty_pass2_still_runs_permissive():
    nim = AsyncMock()
    nim.complete_text.side_effect = [
        {"candidates": []},
        {
            "candidates": [
                {
                    "timestamp_s": 5.0,
                    "source_frame_id": "shot_02",
                    "work_title": "Trans-fixed",
                    "work_creator": "Chris Burden",
                    "work_year": 1974,
                    "work_type": "other",
                    "reasoning": "outstretched figure + cruciform pose + harsh ground",
                    "raw_confidence": 0.55,
                }
            ]
        },
    ]
    rp = RefProposer(nim_client=nim, model="m")
    out = await rp.propose(
        title="x", channel="y", lyrics_text="",
        frame_analyses=[_fa("shot_02", 5.0)],
    )
    assert nim.complete_text.await_count == 2
    pass2_prompt = nim.complete_text.await_args_list[1].kwargs["messages"][0]["content"]
    assert "Types already proposed by the previous pass: (none)" in pass2_prompt
    assert len(out) == 1
    assert out[0].work_title == "Trans-fixed"


async def test_on_candidate_callback_called_for_each_merged_candidate(monkeypatch):
    """on_candidate is invoked once per merged ReferenceCandidate."""
    proposer = RefProposer(nim_client=AsyncMock(), model="m")

    fake_pass1 = [
        ReferenceCandidate(
            timestamp_s=10.0, source_frame_id="shot_01",
            work_title="A", work_creator="X", work_year=2000,
            work_type="painting", reasoning="r", raw_confidence=0.8,
        ),
        ReferenceCandidate(
            timestamp_s=20.0, source_frame_id="shot_02",
            work_title="B", work_creator="Y", work_year=2001,
            work_type="film", reasoning="r", raw_confidence=0.7,
        ),
    ]

    async def fake_call(template, ctx):
        return fake_pass1 if "types_covered" not in ctx else []

    monkeypatch.setattr(proposer, "_call", fake_call)

    received: list[str] = []
    async def on_candidate(c):
        received.append(c.work_title)

    out = await proposer.propose(
        title="t", channel="c", lyrics_text="",
        frame_analyses=[], on_candidate=on_candidate,
    )

    assert len(out) == 2
    assert received == ["A", "B"]
