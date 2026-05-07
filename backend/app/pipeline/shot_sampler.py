from __future__ import annotations
from pathlib import Path
from typing import Sequence
import ffmpeg
from scenedetect import detect, ContentDetector

from app.models import KeyFrame


def _extract_frame_at(video_path: Path, timestamp_s: float, out: Path) -> None:
    """Extract a single JPEG frame at `timestamp_s` to `out`."""
    out.parent.mkdir(parents=True, exist_ok=True)
    (
        ffmpeg.input(str(video_path), ss=timestamp_s)
        .output(str(out), vframes=1, **{"q:v": 3})
        .overwrite_output()
        .run(quiet=True, capture_stdout=True, capture_stderr=True)
    )


class ShotSampler:
    def __init__(self, out_dir: Path, max_shots: int = 80, frames_per_shot: int = 1):
        self._out_dir = out_dir
        self._max_shots = max_shots
        self._frames_per_shot = frames_per_shot

    def _select_shots(self, scene_list: Sequence[tuple]) -> list[tuple[float, float]]:
        all_shots = [(s.get_seconds(), e.get_seconds()) for s, e in scene_list]
        if len(all_shots) <= self._max_shots:
            return all_shots
        # Evenly distribute selection across the timeline
        n = len(all_shots)
        step = n / self._max_shots
        return [all_shots[int(i * step)] for i in range(self._max_shots)]

    def sample(self, video_path: Path, *, youtube_id: str) -> list[KeyFrame]:
        scene_list = detect(str(video_path), ContentDetector(threshold=27.0))
        shots = self._select_shots(scene_list)

        frames_dir = self._out_dir / youtube_id
        frames_dir.mkdir(parents=True, exist_ok=True)

        keyframes: list[KeyFrame] = []
        for i, (start, end) in enumerate(shots):
            mid = (start + end) / 2.0
            shot_id = f"shot_{i:02d}"
            out_path = frames_dir / f"{shot_id}.jpg"
            _extract_frame_at(video_path, mid, out_path)
            keyframes.append(
                KeyFrame(shot_id=shot_id, timestamp_s=mid, frame_path=out_path)
            )
        return keyframes
