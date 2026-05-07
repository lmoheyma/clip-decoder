from __future__ import annotations
import asyncio
from collections import defaultdict
from typing import AsyncIterator
from app.models import PipelineEvent


class EventBus:
    """Per-youtube_id pub/sub for pipeline events.

    Subscribers receive events from publication time onward. Late
    subscribers get a synthetic 'done' if the analysis already
    finished — that contract is the orchestrator's responsibility.
    """

    def __init__(self):
        self._queues: dict[str, list[asyncio.Queue[PipelineEvent | None]]] = (
            defaultdict(list)
        )
        self._lock = asyncio.Lock()

    async def publish(self, youtube_id: str, event: PipelineEvent) -> None:
        async with self._lock:
            queues = list(self._queues.get(youtube_id, []))
        for q in queues:
            await q.put(event)
        if event.step in ("done", "error"):
            await self._close(youtube_id)

    async def subscribe(self, youtube_id: str) -> AsyncIterator[PipelineEvent]:
        q: asyncio.Queue[PipelineEvent | None] = asyncio.Queue()
        async with self._lock:
            self._queues[youtube_id].append(q)
        try:
            while True:
                ev = await q.get()
                if ev is None:
                    return
                yield ev
                if ev.step in ("done", "error"):
                    return
        finally:
            async with self._lock:
                if q in self._queues.get(youtube_id, []):
                    self._queues[youtube_id].remove(q)

    async def _close(self, youtube_id: str) -> None:
        async with self._lock:
            queues = list(self._queues.get(youtube_id, []))
            self._queues.pop(youtube_id, None)
        for q in queues:
            await q.put(None)
