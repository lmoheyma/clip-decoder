from pathlib import Path
from unittest.mock import patch, MagicMock
from app.pipeline.shot_sampler import ShotSampler


def test_evenly_distributes_when_exceeding_cap(tmp_path: Path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    # Pretend PySceneDetect found 200 shots
    fake_shots = [(i * 1.0, (i + 1) * 1.0) for i in range(200)]

    with patch("app.pipeline.shot_sampler.detect", return_value=_to_scene_list(fake_shots)), \
         patch("app.pipeline.shot_sampler._extract_frame_at") as ex:
        ex.side_effect = lambda video_path, t, out: out.write_bytes(b"img")
        s = ShotSampler(out_dir=tmp_path / "frames", max_shots=10, frames_per_shot=1)
        keyframes = s.sample(video, youtube_id="abc")

    assert len(keyframes) == 10
    # Roughly evenly spaced timestamps
    timestamps = [k.timestamp_s for k in keyframes]
    assert timestamps == sorted(timestamps)
    assert timestamps[0] < timestamps[-1]


def test_one_frame_per_shot_under_cap(tmp_path: Path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    fake_shots = [(0.0, 5.0), (5.0, 12.0), (12.0, 18.0)]

    with patch("app.pipeline.shot_sampler.detect", return_value=_to_scene_list(fake_shots)), \
         patch("app.pipeline.shot_sampler._extract_frame_at") as ex:
        ex.side_effect = lambda video_path, t, out: out.write_bytes(b"img")
        s = ShotSampler(out_dir=tmp_path / "frames", max_shots=80, frames_per_shot=1)
        keyframes = s.sample(video, youtube_id="abc")

    assert len(keyframes) == 3
    assert keyframes[0].shot_id == "shot_00"
    assert keyframes[1].shot_id == "shot_01"
    assert keyframes[2].shot_id == "shot_02"
    # Each frame is the midpoint of its shot
    assert keyframes[0].timestamp_s == 2.5
    assert keyframes[1].timestamp_s == 8.5


def _to_scene_list(timecodes):
    """PySceneDetect returns list of (FrameTimecode, FrameTimecode)."""
    out = []
    for start, end in timecodes:
        s = MagicMock()
        s.get_seconds.return_value = start
        e = MagicMock()
        e.get_seconds.return_value = end
        out.append((s, e))
    return out
