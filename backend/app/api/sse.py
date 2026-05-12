from __future__ import annotations
import asyncio
from collections import defaultdict
from typing import AsyncIterator
from app.models import PipelineEvent


class EventBus:
    """Per-youtube_id pub/sub for pipeline events.

    Late subscribers race the orchestrator: the pipeline starts as soon
    as /analyze returns, but the frontend only opens its EventSource
    after navigating to the report page — by then the first few events
    have usually already fired. To make the live SSE display work in
    that scenario we keep a per-id replay history. New subscribers
    receive the full history first, then the live tail. After the
    pipeline finishes (`done` / `error`) the history is retained so
    listeners that connect at any time see a consistent view; it is
    cleared lazily when a new run starts for the same id.
    """

    # Pace at which buffered (replay) events are yielded to a new
    # subscriber. Without this, React batches every state update from
    # the burst into a single render and the pipeline display jumps
    # from empty to "done" with no visible animation.
    # Slow pace for transitions (user perceives the pipeline progressing).
    _REPLAY_PACE_TRANSITION_S: float = 0.18
    # Fast pace for bursty per-frame/per-candidate events. With ~80
    # vision_frame events per run, a uniform 0.18s would mean ~14s of
    # replay on reload-mid-pipeline.
    _REPLAY_PACE_BURST_S: float = 0.02
    # Steps that fire in high-volume bursts during a run.
    _BURST_STEPS: frozenset[str] = frozenset(
        {"vision_frame", "crossref_candidate"}
    )

    def __init__(self):
        self._queues: dict[str, list[asyncio.Queue[PipelineEvent | None]]] = (
            defaultdict(list)
        )
        self._history: dict[str, list[PipelineEvent]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def publish(self, youtube_id: str, event: PipelineEvent) -> None:
        async with self._lock:
            history = self._history[youtube_id]
            # If a previous run already terminated for this id, start fresh.
            if history and history[-1].step in ("done", "error"):
                history.clear()
            history.append(event)
            queues = list(self._queues.get(youtube_id, []))
        for q in queues:
            await q.put(event)
        if event.step in ("done", "error"):
            await self._close(youtube_id)

    async def subscribe(self, youtube_id: str) -> AsyncIterator[PipelineEvent]:
        q: asyncio.Queue[PipelineEvent | None] = asyncio.Queue()
        async with self._lock:
            # Snapshot the history and register the live queue atomically
            # so events published after this point are not missed and
            # already-published events are not duplicated.
            backlog = list(self._history.get(youtube_id, []))
            self._queues[youtube_id].append(q)
        terminated = backlog and backlog[-1].step in ("done", "error")
        try:
            # Yield the replay backlog with a small pace between events
            # so React can render the progression rather than batching
            # the burst into a single update.
            for i, ev in enumerate(backlog):
                yield ev
                if i < len(backlog) - 1:
                    pace = (
                        self._REPLAY_PACE_BURST_S
                        if ev.step in self._BURST_STEPS
                        else self._REPLAY_PACE_TRANSITION_S
                    )
                    await asyncio.sleep(pace)
            if terminated:
                return
            while True:
                ev = await q.get()
                if ev is None:
                    return
                yield ev
                if ev.step in ("done", "error"):
                    return
        finally:
            async with self._lock:
                queues = self._queues.get(youtube_id)
                if queues and q in queues:
                    queues.remove(q)

    async def _close(self, youtube_id: str) -> None:
        async with self._lock:
            queues = list(self._queues.get(youtube_id, []))
            self._queues.pop(youtube_id, None)
        for q in queues:
            await q.put(None)
