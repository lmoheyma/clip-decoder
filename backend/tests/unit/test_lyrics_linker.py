from unittest.mock import AsyncMock
from app.models import Caption, FrameAnalysis
from app.pipeline.lyrics_linker import LyricsLinker


def _fa(frame_id: str, ts: float) -> FrameAnalysis:
    return FrameAnalysis(
        timestamp_s=ts, frame_id=frame_id,
        composition="neon corridor", palette=["red"],
        camera_move="static", costume_setting="city street at night",
        distinctive_features=["motion blur"], raw_description="streets",
        confidence_in_observation=0.9,
    )


def _cap(ts: float, text: str) -> Caption:
    return Caption(start_s=ts, end_s=ts + 1.0, text=text)


def _payload(links):
    return {"links": links}


async def test_links_validated_and_relation_normalized():
    nim = AsyncMock()
    nim.complete_text.return_value = _payload([
        {
            "lyric_timestamp_s": 42.0, "lyric": "running through the city",
            "frame_id": "shot_03", "frame_timestamp_s": 43.0,
            "relation": "LITERAL-ish", "note": "streaked night streets",
        },
    ])
    linker = LyricsLinker(nim_client=nim, model="m")
    out = await linker.link(
        title="t", captions=[_cap(42.0, "running through the city")],
        frame_analyses=[_fa("shot_03", 43.0)],
    )
    assert len(out) == 1
    assert out[0].relation == "other"  # unknown value normalized
    assert out[0].frame_id == "shot_03"


async def test_empty_captions_short_circuits_without_nim_call():
    nim = AsyncMock()
    linker = LyricsLinker(nim_client=nim, model="m")
    out = await linker.link(title="t", captions=[], frame_analyses=[_fa("shot_00", 0.0)])
    assert out == []
    nim.complete_text.assert_not_awaited()


async def test_link_with_unknown_frame_id_is_dropped():
    nim = AsyncMock()
    nim.complete_text.return_value = _payload([
        {
            "lyric_timestamp_s": 1.0, "lyric": "x", "frame_id": "shot_99",
            "frame_timestamp_s": 1.0, "relation": "literal", "note": "n",
        },
    ])
    linker = LyricsLinker(nim_client=nim, model="m")
    out = await linker.link(
        title="t", captions=[_cap(1.0, "x")], frame_analyses=[_fa("shot_00", 0.0)]
    )
    assert out == []


async def test_links_capped_at_max():
    nim = AsyncMock()
    nim.complete_text.return_value = _payload([
        {
            "lyric_timestamp_s": float(i), "lyric": f"l{i}", "frame_id": "shot_00",
            "frame_timestamp_s": 0.0, "relation": "motif", "note": "n",
        }
        for i in range(5)
    ])
    linker = LyricsLinker(nim_client=nim, model="m", max_links=2)
    out = await linker.link(
        title="t", captions=[_cap(0.0, "l")], frame_analyses=[_fa("shot_00", 0.0)]
    )
    assert len(out) == 2


async def test_nim_failure_returns_empty():
    nim = AsyncMock()
    nim.complete_text.side_effect = RuntimeError("boom")
    linker = LyricsLinker(nim_client=nim, model="m")
    out = await linker.link(
        title="t", captions=[_cap(1.0, "x")], frame_analyses=[_fa("shot_00", 0.0)]
    )
    assert out == []


async def test_malformed_link_item_is_dropped():
    nim = AsyncMock()
    nim.complete_text.return_value = _payload([
        {"lyric": "missing required fields"},  # no timestamps/frame_id/etc.
        {
            "lyric_timestamp_s": 1.0, "lyric": "ok", "frame_id": "shot_00",
            "frame_timestamp_s": 1.0, "relation": "literal", "note": "n",
        },
    ])
    linker = LyricsLinker(nim_client=nim, model="m")
    out = await linker.link(
        title="t", captions=[_cap(1.0, "ok")], frame_analyses=[_fa("shot_00", 1.0)]
    )
    # The malformed item is dropped via ValidationError; the valid one survives.
    assert len(out) == 1
    assert out[0].lyric == "ok"
