from __future__ import annotations
import logging
from typing import Awaitable, Callable
from pydantic import ValidationError
from app.models import Caption, FrameAnalysis, LyricLink
from app.nim.client import NimClient
from app.prompts.loader import load_prompt

logger = logging.getLogger(__name__)

_RELATIONS = {"literal", "motif", "contrast", "amplification", "other"}


def _escape_braces(s: str) -> str:
    return s.replace("{", "{{").replace("}", "}}")


def _format_lyric_lines(captions: list[Caption]) -> str:
    return _escape_braces(
        "\n".join(f"[{c.start_s:.1f}s] {c.text}" for c in captions)
    )


def _format_frame_summaries(frames: list[FrameAnalysis]) -> str:
    blocks = [
        f"[{f.frame_id} @ {f.timestamp_s:.1f}s] {f.composition}; "
        f"setting={f.costume_setting}; "
        f"features={', '.join(f.distinctive_features)}"
        for f in frames
    ]
    return _escape_braces("\n".join(blocks))


class LyricsLinker:
    """Pairs notable lyric lines to on-screen frames via one LLM call.

    Best-effort: any failure (no captions, NIM error, bad JSON) yields an
    empty list — this stage must never fail an otherwise-successful run.
    """

    def __init__(self, nim_client: NimClient, model: str, max_links: int = 10):
        self._nim = nim_client
        self._model = model
        self._max_links = max_links
        self._tpl = load_prompt("lyrics_linker")

    async def link(
        self,
        *,
        title: str,
        captions: list[Caption],
        frame_analyses: list[FrameAnalysis],
        on_progress: Callable[[str, float], Awaitable[None]] | None = None,
    ) -> list[LyricLink]:
        if not captions:
            return []
        frame_ids = {f.frame_id for f in frame_analyses}
        ctx = {
            "title": _escape_braces(title or "(unknown)"),
            "lyric_lines": _format_lyric_lines(captions),
            "frame_summaries": _format_frame_summaries(frame_analyses),
            "max_links": self._max_links,
        }
        if on_progress:
            await on_progress("Linking lyrics to visuals…", 0.97)
        try:
            data = await self._nim.complete_text(
                model=self._model,
                messages=[{"role": "user", "content": self._tpl.format(**ctx)}],
                json_mode=True,
            )
        except Exception:
            logger.exception("lyrics linking failed — skipping section")
            return []

        raw = data.get("links") or []
        out: list[LyricLink] = []
        for item in raw:
            try:
                link = LyricLink.model_validate(item)
            except ValidationError as e:
                logger.debug("dropped invalid lyric link %r: %s", item, e)
                continue
            if link.frame_id not in frame_ids:
                logger.debug("dropped lyric link with unknown frame %r", link.frame_id)
                continue
            if link.relation not in _RELATIONS:
                link.relation = "other"
            out.append(link)
            if len(out) >= self._max_links:
                break
        return out
