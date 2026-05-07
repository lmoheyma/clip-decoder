from __future__ import annotations
import json
from typing import Iterable
from pydantic import ValidationError
from app.models import FrameAnalysis, ReferenceCandidate
from app.nim.client import NimClient
from app.prompts.loader import load_prompt


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
    return "\n".join(blocks)


class RefProposer:
    def __init__(self, nim_client: NimClient, model: str):
        self._nim = nim_client
        self._model = model
        self._template = load_prompt("ref_proposer")

    async def propose(
        self,
        *,
        title: str,
        channel: str,
        lyrics_text: str,
        frame_analyses: list[FrameAnalysis],
    ) -> list[ReferenceCandidate]:
        prompt = self._template.format(
            title=title or "(unknown)",
            channel=channel or "(unknown)",
            lyrics=lyrics_text or "(none)",
            frame_summaries=_format_frame_summaries(frame_analyses),
        )
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
            except ValidationError:
                # Drop silently — vague/incomplete claims are filtered by design.
                continue
        return out
