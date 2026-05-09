from __future__ import annotations
import logging
from typing import Iterable
from pydantic import ValidationError
from app.models import FrameAnalysis, ReferenceCandidate
from app.nim.client import NimClient
from app.prompts.loader import load_prompt

logger = logging.getLogger(__name__)


def _escape_braces(s: str) -> str:
    """Escape literal braces so the string survives a `.format()` substitution."""
    return s.replace("{", "{{").replace("}", "}}")


def _format_frame_summaries(frames: Iterable[FrameAnalysis]) -> str:
    blocks = []
    for f in frames:
        blocks.append(
            f"[{f.frame_id} @ {f.timestamp_s:.1f}s] "
            f"composition={f.composition}; "
            f"palette={', '.join(f.palette)}; "
            f"camera={f.camera_move}; "
            f"setting={f.costume_setting}; "
            f"features={', '.join(f.distinctive_features)}; "
            f"raw={f.raw_description}"
        )
    return _escape_braces("\n".join(blocks))


class RefProposer:
    def __init__(self, nim_client: NimClient, model: str):
        self._nim = nim_client
        self._model = model
        self._tpl_general = load_prompt("ref_proposer")
        self._tpl_complement = load_prompt("ref_proposer_complement")

    async def _call(self, template: str, ctx: dict) -> list[ReferenceCandidate]:
        prompt = template.format(**ctx)
        data = await self._nim.complete_text(
            model=self._model,
            messages=[{"role": "user", "content": prompt}],
            json_mode=True,
        )
        raw = data.get("candidates") or []
        out: list[ReferenceCandidate] = []
        for item in raw:
            try:
                out.append(ReferenceCandidate.model_validate(item))
            except ValidationError as e:
                logger.debug("dropped invalid candidate %r: %s", item, e)
                continue
        return out

    async def propose(
        self,
        *,
        title: str,
        channel: str,
        lyrics_text: str,
        frame_analyses: list[FrameAnalysis],
    ) -> list[ReferenceCandidate]:
        ctx = {
            "title": _escape_braces(title or "(unknown)"),
            "channel": _escape_braces(channel or "(unknown)"),
            "lyrics": _escape_braces(lyrics_text or "(none)"),
            "frame_summaries": _format_frame_summaries(frame_analyses),
        }
        return await self._call(self._tpl_general, ctx)
