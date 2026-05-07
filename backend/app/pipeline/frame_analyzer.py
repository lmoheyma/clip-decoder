from __future__ import annotations
import asyncio
from typing import Awaitable, Callable, Iterable
from app.models import FrameAnalysis, KeyFrame
from app.nim.client import NimClient
from app.prompts.loader import load_prompt


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, float(v)))


class FrameAnalyzer:
    def __init__(
        self,
        nim_client: NimClient,
        model: str,
        concurrency: int = 4,
        on_progress: Callable[[int, int], Awaitable[None]] | None = None,
    ):
        self._nim = nim_client
        self._model = model
        self._sem = asyncio.Semaphore(concurrency)
        self._on_progress = on_progress
        self._prompt = load_prompt("frame_analyzer")

    async def _one(self, kf: KeyFrame) -> FrameAnalysis:
        async with self._sem:
            data = await self._nim.analyze_image(
                model=self._model,
                image_path=kf.frame_path,
                prompt=self._prompt,
                json_mode=True,
            )
        return FrameAnalysis(
            timestamp_s=kf.timestamp_s,
            frame_id=kf.shot_id,
            composition=str(data.get("composition", "")),
            palette=[str(x) for x in (data.get("palette") or [])],
            camera_move=str(data.get("camera_move", "unknown")),
            costume_setting=str(data.get("costume_setting", "")),
            distinctive_features=[
                str(x) for x in (data.get("distinctive_features") or [])
            ],
            raw_description=str(data.get("raw_description", "")),
            confidence_in_observation=_clamp(
                float(data.get("confidence_in_observation", 0.5))
            ),
        )

    async def analyze(self, keyframes: Iterable[KeyFrame]) -> list[FrameAnalysis]:
        kfs = list(keyframes)
        results: list[FrameAnalysis] = [None] * len(kfs)  # type: ignore[list-item]
        completed = 0
        total = len(kfs)

        async def worker(i: int, kf: KeyFrame) -> None:
            nonlocal completed
            results[i] = await self._one(kf)
            completed += 1
            if self._on_progress:
                await self._on_progress(completed, total)

        await asyncio.gather(*(worker(i, kf) for i, kf in enumerate(kfs)))
        return results
