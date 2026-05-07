from app.prompts.loader import load_prompt


def test_load_frame_analyzer_prompt_contains_evidence_only_clause():
    p = load_prompt("frame_analyzer")
    assert "evidence" in p.lower()
    assert "json" in p.lower()


def test_load_ref_proposer_rejects_vague():
    p = load_prompt("ref_proposer")
    assert "named" in p.lower()
    assert "{frame_summaries}" in p


def test_load_verifier_adversarial():
    p = load_prompt("verifier")
    assert "reject" in p.lower()
    assert "{candidate}" in p
    assert "{frame_analysis}" in p


def test_unknown_prompt_raises():
    import pytest
    with pytest.raises(FileNotFoundError):
        load_prompt("nope")
