from __future__ import annotations
import asyncio
import logging
from typing import Awaitable, Callable, Iterable
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


def _merge(
    pass1: list[ReferenceCandidate],
    pass2: list[ReferenceCandidate],
) -> list[ReferenceCandidate]:
    """Concatenate pass 1 + pass 2, dedup on case-insensitive
    (work_title, work_creator). Pass 1 entries always win on collision."""
    seen: set[tuple[str, str]] = set()
    out: list[ReferenceCandidate] = []
    for c in pass1 + pass2:
        key = (c.work_title.casefold(), c.work_creator.casefold())
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


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
        on_candidate: Callable[[ReferenceCandidate], Awaitable[None]] | None = None,
        on_progress: Callable[[str, float], Awaitable[None]] | None = None,
    ) -> list[ReferenceCandidate]:
        base_ctx = {
            "title": _escape_braces(title or "(unknown)"),
            "channel": _escape_braces(channel or "(unknown)"),
            "lyrics": _escape_braces(lyrics_text or "(none)"),
            "frame_summaries": _format_frame_summaries(frame_analyses),
        }
        if on_progress:
            await on_progress(
                "Pass 1 + 2: asking LLM for references in parallel…", 0.6,
            )

        # Pass 1 and pass 2 run concurrently. Pass 2 used to read the set
        # of types already proposed by pass 1 ({types_covered}) to steer
        # toward uncovered types, but waiting for pass 1 to finish doubled
        # the wall-clock cost of this step. We fan out both at once and
        # pass `(none)` to pass 2 — the complement prompt's "all types
        # open" branch — then rely on _merge()'s case-insensitive
        # (title, creator) dedup to drop the overlapping candidates.
        pass2_ctx = {**base_ctx, "types_covered": "(none)"}
        pass1_task = asyncio.create_task(self._call(self._tpl_general, base_ctx))
        pass2_task = asyncio.create_task(self._call(self._tpl_complement, pass2_ctx))

        pass1_res, pass2_res = await asyncio.gather(
            pass1_task, pass2_task, return_exceptions=True,
        )
        if isinstance(pass1_res, BaseException):
            logger.error("ref proposer pass 1 failed: %s", pass1_res)
            pass1 = []
        else:
            pass1 = pass1_res
        if isinstance(pass2_res, BaseException):
            logger.warning(
                "ref proposer pass 2 failed (%s) — keeping pass 1 only",
                pass2_res,
            )
            pass2 = []
        else:
            pass2 = pass2_res
        if on_progress:
            await on_progress(
                f"Pass 1: {len(pass1)} · Pass 2: {len(pass2)} candidates", 0.67,
            )

        merged = _merge(pass1, pass2)
        if on_progress:
            await on_progress(
                f"Merged → {len(merged)} unique candidates", 0.69,
            )
        if on_candidate:
            for c in merged:
                await on_candidate(c)
        return merged
