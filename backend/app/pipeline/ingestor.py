from __future__ import annotations
import json
import re
from pathlib import Path
from typing import Any
from yt_dlp import YoutubeDL

from app.models import Caption, IngestResult

# Resource ceiling per analysis. Public-deploy guard: prevents a
# multi-hour livestream / 4 GB upload from blowing out disk + NIM
# credits before downstream stages have a chance to bail.
MAX_DURATION_S = 15 * 60  # 15 min
MAX_FILESIZE_BYTES = 300 * 1024 * 1024  # 300 MB at 480p mp4


# Rolling auto-caption build-ups are emitted as contiguous events a second
# or two apart; a prefix line that recurs much later is a distinct lyric, so
# only coalesce prefixes within this window.
_COALESCE_WINDOW_S = 3.0

_BRACKET_MARKER_RE = re.compile(r"^(\[.*\]|\(.*\))$")
_WS_RE = re.compile(r"\s+")
_NON_LYRIC = {"♪", "♪♪"}


def _parse_json3(text: str) -> list[Caption]:
    """Parse a YouTube json3 subtitle blob into clean Caption lines.

    Coalesces the rolling auto-caption build-up (a line re-emitted word by
    word across consecutive events) down to its final form, and drops
    non-lyric markers like [Music] / [Applause] and blank cues.
    """
    data = json.loads(text)
    raw: list[Caption] = []
    for ev in data.get("events", []):
        segs = ev.get("segs")
        if not segs:
            continue
        line = "".join(s.get("utf8", "") for s in segs)
        line = _WS_RE.sub(" ", line).strip()
        if not line or line in _NON_LYRIC or _BRACKET_MARKER_RE.match(line):
            continue
        start = float(ev.get("tStartMs", 0)) / 1000.0
        dur = float(ev.get("dDurationMs", 0)) / 1000.0
        raw.append(Caption(start_s=start, end_s=start + dur, text=line))

    out: list[Caption] = []
    for i, cap in enumerate(raw):
        nxt = raw[i + 1] if i + 1 < len(raw) else None
        # Rolling build-up: drop a line that is a prefix of the next one,
        # but only when the next event is close in time (build-ups are
        # tightly sequential; far-apart matches are distinct lyrics).
        if (
            nxt is not None
            and nxt.text.startswith(cap.text)
            and nxt.start_s - cap.start_s <= _COALESCE_WINDOW_S
        ):
            continue
        # Drop consecutive exact duplicates.
        if out and out[-1].text == cap.text:
            continue
        out.append(cap)
    return out


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
