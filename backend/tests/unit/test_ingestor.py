from pathlib import Path
from unittest.mock import patch, MagicMock
from app.pipeline.ingestor import Ingestor, parse_youtube_id


def test_parse_youtube_id_standard():
    assert parse_youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"


def test_parse_youtube_id_short():
    assert parse_youtube_id("https://youtu.be/dQw4w9WgXcQ?si=foo") == "dQw4w9WgXcQ"


def test_parse_youtube_id_invalid_raises():
    import pytest
    with pytest.raises(ValueError):
        parse_youtube_id("https://example.com/foo")


def test_ingest_returns_metadata(tmp_path: Path):
    fake_video = tmp_path / "video.mp4"
    fake_video.write_bytes(b"fake")

    info = {
        "id": "dQw4w9WgXcQ",
        "title": "Test Title",
        "channel": "Test Channel",
        "duration": 240,
        "subtitles": {},
        "automatic_captions": {},
    }

    fake_ydl = MagicMock()
    fake_ydl.__enter__.return_value = fake_ydl
    fake_ydl.__exit__.return_value = False
    fake_ydl.extract_info.return_value = info
    fake_ydl.prepare_filename.return_value = str(fake_video)

    with patch("app.pipeline.ingestor.YoutubeDL", return_value=fake_ydl):
        ing = Ingestor(work_dir=tmp_path)
        result = ing.ingest("https://www.youtube.com/watch?v=dQw4w9WgXcQ")

    assert result.youtube_id == "dQw4w9WgXcQ"
    assert result.title == "Test Title"
    assert result.duration_s == 240.0
    assert result.video_path == fake_video
    assert result.captions == []


def test_parse_json3_coalesces_rolling_lines_and_drops_markers():
    import json
    from app.pipeline.ingestor import _parse_json3

    # Rolling build-up of one line, then a [Music] marker, then a final line.
    payload = json.dumps({
        "events": [
            {"tStartMs": 1000, "dDurationMs": 500, "segs": [{"utf8": "I'm"}]},
            {"tStartMs": 1100, "dDurationMs": 500,
             "segs": [{"utf8": "I'm "}, {"utf8": "running"}]},
            {"tStartMs": 1200, "dDurationMs": 800,
             "segs": [{"utf8": "I'm running "}, {"utf8": "through the city"}]},
            {"tStartMs": 5000, "dDurationMs": 300, "segs": [{"utf8": "[Music]"}]},
            {"tStartMs": 6000, "dDurationMs": 900,
             "segs": [{"utf8": "gold on my mind"}]},
            {"tStartMs": 7000, "dDurationMs": 100, "segs": [{"utf8": "\n"}]},
        ]
    })

    caps = _parse_json3(payload)
    texts = [c.text for c in caps]
    # Rolling prefixes collapse to the final, longest form; marker + blank dropped.
    assert texts == ["I'm running through the city", "gold on my mind"]
    assert caps[0].start_s == 1.2
    assert caps[1].start_s == 6.0
