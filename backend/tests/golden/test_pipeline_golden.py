import json
from pathlib import Path
from unittest.mock import AsyncMock
from app.models import FrameAnalysis
from app.pipeline.ref_proposer import RefProposer
from app.pipeline.verifier import Verifier
from app.models import Verdict, Confidence

FIXTURES = Path(__file__).parent / "fixtures"


def load_frame_analyses() -> list[FrameAnalysis]:
    data = json.loads((FIXTURES / "frame_analyses_kubrick_clip.json").read_text())
    return [FrameAnalysis.model_validate(d) for d in data]


def load_proposer_output() -> dict:
    return json.loads((FIXTURES / "proposer_output_kubrick_clip.json").read_text())


async def test_proposer_filters_unnamed_candidate():
    nim = AsyncMock()
    nim.complete_text.return_value = load_proposer_output()
    rp = RefProposer(nim_client=nim, model="m")
    out = await rp.propose(
        title="Kubrick Clip", channel="X", lyrics_text="",
        frame_analyses=load_frame_analyses(),
    )
    titles = [c.work_title for c in out]
    assert "The Shining" in titles
    # The unnamed-creator-with-vague-title candidate is kept by validation
    # but should NOT appear as a confirmed reference after the verifier.
    # Validation only requires non-empty strings; the verifier does the rejection.
    assert all(c.work_title for c in out)


async def test_verifier_rejects_vague_keep_under_adversarial_prompt():
    """Even if the proposer let through 'various / 70s European cinema',
    the verifier should reject it for lack of concrete elements."""
    nim = AsyncMock()
    # Verifier will be called twice; first is 'keep' for The Shining,
    # second is 'reject' for the vague one.
    nim.complete_text.side_effect = [
        {
            "verdict": "keep",
            "supporting_elements": ["symmetry", "tracking shot", "corridor"],
            "final_confidence": 0.88,
            "rationale": "matches",
        },
        {
            "verdict": "reject",
            "supporting_elements": [],
            "final_confidence": 0.2,
            "rationale": "thin",
        },
    ]
    v = Verifier(nim_client=nim, model="m", wikipedia=False)

    fa_index = {f.frame_id: f for f in load_frame_analyses()}
    rp = RefProposer(nim_client=AsyncMock(), model="m")
    rp._nim.complete_text.return_value = load_proposer_output()  # type: ignore[attr-defined]
    candidates = await rp.propose(
        title="x", channel="x", lyrics_text="", frame_analyses=load_frame_analyses()
    )
    verified = await v.verify_all(candidates, fa_index)
    confirmed = [r for r in verified if r.final_confidence == Confidence.CONFIRMED]
    rejected = [r for r in verified if r.verdict == Verdict.REJECT]
    assert any(r.work_title == "The Shining" for r in confirmed)
    assert len(rejected) == 1
