from __future__ import annotations
import logging
from pathlib import Path
from typing import Sequence
import ffmpeg
from scenedetect import detect, ContentDetector

from app.models import KeyFrame

logger = logging.getLogger(__name__)


def _extract_frame_at(video_path: Path, timestamp_s: float, out: Path) -> None:
    """Extract a single JPEG frame at `timestamp_s` to `out`.

    Raises ffmpeg.Error with the captured stderr on failure.
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    (
        ffmpeg.input(str(video_path), ss=timestamp_s)
        .output(str(out), vframes=1, **{"q:v": 3})
        .overwrite_output()
        .run(quiet=True, capture_stdout=True, capture_stderr=True)
    )


class ShotSampler:
    # Pull the seek timestamp at least this far back from the shot's end
    # boundary. ffmpeg fails to extract a frame when the seek lands within
    # the last few decode frames of the file (no surviving filtered frame
    # → mjpeg encoder cannot init). One 30-fps frame is ~33ms; 0.1s gives
    # plenty of headroom across frame rates.
    _BOUNDARY_MARGIN_S: float = 0.1

    def __init__(self, out_dir: Path, max_shots: int = 80, frames_per_shot: int = 1):
        self._out_dir = out_dir
        self._max_shots = max_shots
        self._frames_per_shot = frames_per_shot

    def _select_shots(self, scene_list: Sequence[tuple]) -> list[tuple[float, float]]:
        all_shots = [(s.get_seconds(), e.get_seconds()) for s, e in scene_list]
        if len(all_shots) <= self._max_shots:
            return all_shots
        # Evenly distribute selection across the timeline, including the tail.
        n = len(all_shots)
        step = (n - 1) / (self._max_shots - 1)
        return [all_shots[round(i * step)] for i in range(self._max_shots)]

    def sample(self, video_path: Path, *, youtube_id: str) -> list[KeyFrame]:
        scene_list = detect(str(video_path), ContentDetector(threshold=27.0))
        shots = self._select_shots(scene_list)

        frames_dir = self._out_dir / youtube_id
        frames_dir.mkdir(parents=True, exist_ok=True)

        keyframes: list[KeyFrame] = []
        for i, (start, end) in enumerate(shots):
            mid = (start + end) / 2.0
            # Keep the seek away from end-of-shot / end-of-video boundary.
            seek_ts = max(start, min(mid, end - self._BOUNDARY_MARGIN_S))
            shot_id = f"shot_{i:02d}"
            out_path = frames_dir / f"{shot_id}.jpg"
            try:
                _extract_frame_at(video_path, seek_ts, out_path)
            except ffmpeg.Error as e:
                stderr = (e.stderr or b"").decode(errors="replace")
                logger.warning(
                    "ffmpeg failed for %s @ %.3fs (start=%.3f end=%.3f): %s",
                    shot_id, seek_ts, start, end, stderr.splitlines()[-1] if stderr else "no stderr",
                )
                logger.debug("ffmpeg full stderr for %s:\n%s", shot_id, stderr)
                continue
            keyframes.append(
                KeyFrame(shot_id=shot_id, timestamp_s=mid, frame_path=out_path)
            )
        if not keyframes:
            raise RuntimeError(
                f"shot sampling produced no keyframes (probed {len(shots)} shots)"
            )
        return keyframes
