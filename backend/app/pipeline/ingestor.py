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

    def _ydl_opts(
        self, youtube_id: str, subtitle_langs: list[str] | None = None
    ) -> dict[str, Any]:
        out_template = str(self._work_dir / f"{youtube_id}.%(ext)s")
        opts: dict[str, Any] = {
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
        if subtitle_langs:
            opts.update({
                "writesubtitles": True,
                "writeautomaticsub": True,
                "subtitlesformat": "json3",
                "subtitleslangs": subtitle_langs,
            })
        return opts

    def _choose_caption_langs(self, info: dict[str, Any]) -> list[str]:
        available = {
            **(info.get("automatic_captions") or {}),
            **(info.get("subtitles") or {}),
        }
        if not available:
            return []
        lang = info.get("language") or ""
        for pref in (lang, lang.split("-")[0], "en"):
            if pref and pref in available:
                return [pref]
        return [next(iter(available))]

    def _load_captions(
        self, info: dict[str, Any], youtube_id: str
    ) -> list[Caption]:
        candidates: list[Path] = []
        for sub in (info.get("requested_subtitles") or {}).values():
            fp = sub.get("filepath") if isinstance(sub, dict) else None
            if fp:
                candidates.append(Path(fp))
        candidates.extend(self._work_dir.glob(f"{youtube_id}*.json3"))

        for path in candidates:
            if not path.exists():
                continue
            try:
                caps = _parse_json3(path.read_text(encoding="utf-8"))
            except Exception:
                caps = []
            finally:
                path.unlink(missing_ok=True)
            if caps:
                return caps
        return []

    def ingest(self, url: str) -> IngestResult:
        youtube_id = parse_youtube_id(url)
        # Probe metadata (cheap, no download) to enforce the duration cap
        # and discover which caption languages exist before committing.
        with YoutubeDL(self._ydl_opts(youtube_id)) as ydl:
            probe = ydl.extract_info(url, download=False)
        duration = float(probe.get("duration") or 0)
        if duration > MAX_DURATION_S:
            minutes = MAX_DURATION_S // 60
            raise ValueError(
                f"Clip too long ({duration:.0f}s). "
                f"Maximum supported is {minutes} minutes."
            )

        langs = self._choose_caption_langs(probe)
        with YoutubeDL(self._ydl_opts(youtube_id, subtitle_langs=langs)) as ydl:
            info = ydl.extract_info(url, download=True)
            video_path = Path(ydl.prepare_filename(info))

        captions = self._load_captions(info, youtube_id) if langs else []
        return IngestResult(
            youtube_id=youtube_id,
            video_path=video_path,
            title=info.get("title", ""),
            channel=info.get("channel") or info.get("uploader", ""),
            duration_s=float(info.get("duration") or 0),
            captions=captions,
        )
