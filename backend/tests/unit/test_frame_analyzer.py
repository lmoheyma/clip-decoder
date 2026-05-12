import json
import shutil
from pathlib import Path
from unittest.mock import AsyncMock
from app.models import KeyFrame
from app.pipeline.frame_analyzer import FrameAnalyzer

_FIXTURE_JPG = Path(__file__).parent.parent / "fixtures" / "striped.jpg"


async def test_analyzes_each_frame(tmp_path: Path):
    img = tmp_path / "shot_00.jpg"
    shutil.copy(_FIXTURE_JPG, img)
    keyframes = [
        KeyFrame(shot_id="shot_00", timestamp_s=2.5, frame_path=img),
        KeyFrame(shot_id="shot_01", timestamp_s=8.5, frame_path=img),
    ]

    fake_response = {
        "composition": "centered",
        "palette": ["red", "black"],
        "camera_move": "tracking",
        "costume_setting": "hallway",
        "distinctive_features": ["symmetry"],
        "raw_description": "A red corridor.",
        "confidence_in_observation": 0.9,
    }

    nim = AsyncMock()
    nim.analyze_image.return_value = fake_response

    fa = FrameAnalyzer(nim_client=nim, model="cosmos", concurrency=2)
    results = await fa.analyze(keyframes)

    assert len(results) == 2
    assert results[0].frame_id == "shot_00"
    assert results[0].composition == "centered"
    assert results[0].palette == ["red", "black"]
    assert nim.analyze_image.await_count == 2


async def test_clamps_confidence_in_observation(tmp_path: Path):
    img = tmp_path / "f.jpg"
    shutil.copy(_FIXTURE_JPG, img)
    nim = AsyncMock()
    nim.analyze_image.return_value = {
        "composition": "x",
        "palette": ["x"],
        "camera_move": "static",
        "costume_setting": "x",
        "distinctive_features": [],
        "raw_description": "x",
        "confidence_in_observation": 1.5,  # invalid
    }
    fa = FrameAnalyzer(nim_client=nim, model="m", concurrency=1)
    results = await fa.analyze(
        [KeyFrame(shot_id="s", timestamp_s=0.0, frame_path=img)]
    )
    assert results[0].confidence_in_observation == 1.0


async def test_on_frame_callback_called_for_each_frame(tmp_path: Path):
    img = tmp_path / "shot_00.jpg"
    shutil.copy(_FIXTURE_JPG, img)
    keyframes = [
        KeyFrame(shot_id="shot_00", timestamp_s=2.5, frame_path=img),
        KeyFrame(shot_id="shot_01", timestamp_s=8.5, frame_path=img),
        KeyFrame(shot_id="shot_02", timestamp_s=14.5, frame_path=img),
    ]
    fake_response = {
        "composition": "x",
        "palette": ["red"],
        "camera_move": "static",
        "costume_setting": "x",
        "distinctive_features": [],
        "raw_description": "x",
        "confidence_in_observation": 0.5,
    }
    nim = AsyncMock()
    nim.analyze_image.return_value = fake_response

    calls: list[tuple[str, int, int]] = []

    async def on_frame(fa, index, total):
        calls.append((fa.frame_id, index, total))

    fa = FrameAnalyzer(nim_client=nim, model="m", concurrency=2)
    await fa.analyze(keyframes, on_frame=on_frame)

    assert len(calls) == 3
    for _, _, total in calls:
        assert total == 3
    assert {c[0] for c in calls} == {"shot_00", "shot_01", "shot_02"}
    assert sorted(c[1] for c in calls) == [1, 2, 3]
