from __future__ import annotations
import re
from pathlib import Path
from typing import Any
from yt_dlp import YoutubeDL

from app.models import IngestResult

# Resource ceiling per analysis. Public-deploy guard: prevents a
# multi-hour livestream / 4 GB upload from blowing out disk + NIM
# credits before downstream stages have a chance to bail.
MAX_DURATION_S = 15 * 60  # 15 min
MAX_FILESIZE_BYTES = 300 * 1024 * 1024  # 300 MB at 480p mp4


_YT_ID_RE = re.compile(
    r"""(?:youtube\.com/(?:[^/\n\s]+/\S+/|(?:v|e(?:mbed)?)/|\S*?[?&]v=)
        |youtu\.be/)([A-Za-z0-9_-]{11})""",
    re.VERBOSE,
)


def parse_youtube_id(url: str) -> str:
    m = _YT_ID_RE.search(url)
    if not m:
        raise ValueError(f"Could not extract YouTube ID from URL: {url}")
    return m.group(1)


class Ingestor:
    """Downloads a YouTube video at a low resolution sufficient for analysis."""

    def __init__(self, work_dir: Path):
        self._work_dir = work_dir
        self._work_dir.mkdir(parents=True, exist_ok=True)

    def _ydl_opts(self, youtube_id: str) -> dict[str, Any]:
        out_template = str(self._work_dir / f"{youtube_id}.%(ext)s")
        return {
            "format": "best[height<=480][ext=mp4]/best[height<=480]/best[ext=mp4]/best",
            "outtmpl": out_template,
            "quiet": True,
            "no_warnings": True,
            "writesubtitles": False,
            "writeautomaticsub": False,
            "skip_download": False,
            "noplaylist": True,
            "max_filesize": MAX_FILESIZE_BYTES,
        }

    def ingest(self, url: str) -> IngestResult:
        youtube_id = parse_youtube_id(url)
        opts = self._ydl_opts(youtube_id)
        with YoutubeDL(opts) as ydl:
            # Probe metadata before downloading so an over-long clip
            # rejects without touching disk.
            probe = ydl.extract_info(url, download=False)
            duration = float(probe.get("duration") or 0)
            if duration > MAX_DURATION_S:
                minutes = MAX_DURATION_S // 60
                raise ValueError(
                    f"Clip too long ({duration:.0f}s). "
                    f"Maximum supported is {minutes} minutes."
                )
            info = ydl.extract_info(url, download=True)
            video_path = Path(ydl.prepare_filename(info))
        return IngestResult(
            youtube_id=youtube_id,
            video_path=video_path,
            title=info.get("title", ""),
            channel=info.get("channel") or info.get("uploader", ""),
            duration_s=float(info.get("duration") or 0),
            captions=[],
        )
