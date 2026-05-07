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
