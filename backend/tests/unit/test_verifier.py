import respx
from httpx import Response
from unittest.mock import AsyncMock
from app.models import FrameAnalysis, ReferenceCandidate, Verdict, Confidence
from app.pipeline.verifier import Verifier


def _fa() -> FrameAnalysis:
    return FrameAnalysis(
        timestamp_s=12.5,
        frame_id="shot_03",
        composition="centered corridor",
        palette=["red"],
        camera_move="tracking",
        costume_setting="hallway",
        distinctive_features=["symmetry"],
        raw_description="x",
        confidence_in_observation=0.9,
    )


def _candidate() -> ReferenceCandidate:
    return ReferenceCandidate(
        timestamp_s=12.5,
        source_frame_id="shot_03",
        work_title="The Shining",
        work_creator="Stanley Kubrick",
        work_year=1980,
        work_type="film",
        reasoning="x",
        raw_confidence=0.8,
    )


@respx.mock
async def test_keep_with_wikipedia_match():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "keep",
        "supporting_elements": ["symmetry", "corridor", "tracking"],
        "final_confidence": 0.85,
        "rationale": "matches",
    }
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(return_value=Response(200, json={"content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/The_Shining"}}}))
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    result = await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    assert result.verdict == Verdict.KEEP
    assert result.final_confidence == Confidence.CONFIRMED
    assert "wikipedia.org" in (result.wikipedia_url or "")


@respx.mock
async def test_keep_downgraded_to_speculative_when_wikipedia_missing():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "keep",
        "supporting_elements": ["x", "y", "z"],
        "final_confidence": 0.7,
        "rationale": "ok",
    }
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(return_value=Response(404))
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    result = await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    assert result.verdict == Verdict.KEEP
    assert result.final_confidence == Confidence.SPECULATIVE


async def test_reject_returns_hidden():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "reject",
        "supporting_elements": [],
        "final_confidence": 0.1,
        "rationale": "no",
    }
    v = Verifier(nim_client=nim, model="m", wikipedia=False)
    result = await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    assert result.verdict == Verdict.REJECT
    assert result.final_confidence == Confidence.HIDDEN


@respx.mock
async def test_wikipedia_thumb_parsed_when_present():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "keep",
        "supporting_elements": ["a", "b", "c"],
        "final_confidence": 0.9,
        "rationale": "ok",
    }
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(
        return_value=Response(
            200,
            json={
                "content_urls": {
                    "desktop": {"page": "https://en.wikipedia.org/wiki/The_Shining"}
                },
                "thumbnail": {
                    "source": "https://upload.wikimedia.org/.../200px-shining.jpg",
                    "width": 200,
                    "height": 200,
                },
            },
        )
    )
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    result = await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    assert result.wikipedia_thumbnail_url == "https://upload.wikimedia.org/.../200px-shining.jpg"


@respx.mock
async def test_wikipedia_thumb_none_when_absent():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "keep",
        "supporting_elements": ["a", "b", "c"],
        "final_confidence": 0.9,
        "rationale": "ok",
    }
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(
        return_value=Response(
            200,
            json={
                "content_urls": {
                    "desktop": {"page": "https://en.wikipedia.org/wiki/The_Shining"}
                },
                # no "thumbnail" key
            },
        )
    )
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    result = await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    assert result.wikipedia_url is not None
    assert result.wikipedia_thumbnail_url is None


@respx.mock
async def test_wiki_lookup_returns_summary_extract():
    nim = AsyncMock()
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(
        return_value=Response(
            200,
            json={
                "extract": "The Shining is a 1980 horror film directed by Stanley Kubrick.",
                "content_urls": {
                    "desktop": {"page": "https://en.wikipedia.org/wiki/The_Shining"}
                },
                "thumbnail": {"source": "https://upload.wikimedia.org/foo.jpg"},
            },
        )
    )
    page_url, thumb_url, summary = await v._wiki_lookup("The Shining")
    assert page_url == "https://en.wikipedia.org/wiki/The_Shining"
    assert thumb_url == "https://upload.wikimedia.org/foo.jpg"
    assert "The Shining is a 1980 horror film" in summary


@respx.mock
async def test_wiki_lookup_missing_page_returns_empty_summary():
    nim = AsyncMock()
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/Bogus"
    ).mock(return_value=Response(404))
    page_url, thumb_url, summary = await v._wiki_lookup("Bogus")
    assert page_url is None
    assert thumb_url is None
    assert summary == ""
