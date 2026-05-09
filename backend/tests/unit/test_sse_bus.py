import asyncio

import pytest

from app.api.sse import EventBus
from app.models import PipelineEvent


def _ev(step: str, progress: float = 0.0) -> PipelineEvent:
    return PipelineEvent(step=step, message=step, progress=progress, payload={})


@pytest.mark.asyncio
async def test_late_subscriber_receives_replay_history():
    bus = EventBus()

    # Pipeline emits several events before any subscriber connects —
    # this is the realistic race when the frontend opens EventSource
    # after a redirect.
    await bus.publish("vid", _ev("ingest", 0.1))
    await bus.publish("vid", _ev("shots", 0.2))
    await bus.publish("vid", _ev("vision", 0.25))

    received: list[str] = []

    async def consume() -> None:
        async for ev in bus.subscribe("vid"):
            received.append(ev.step)
            if ev.step == "done":
                return

    task = asyncio.create_task(consume())
    # Yield so the consumer drains the replay history before live events.
    await asyncio.sleep(0)

    await bus.publish("vid", _ev("vision", 0.55))
    await bus.publish("vid", _ev("done", 1.0))

    await asyncio.wait_for(task, timeout=2.0)

    assert received == ["ingest", "shots", "vision", "vision", "done"]


@pytest.mark.asyncio
async def test_subscriber_after_done_replays_full_history():
    bus = EventBus()

    for step, p in [("ingest", 0.1), ("shots", 0.2), ("done", 1.0)]:
        await bus.publish("vid", _ev(step, p))

    seen: list[str] = []
    async for ev in bus.subscribe("vid"):
        seen.append(ev.step)

    assert seen == ["ingest", "shots", "done"]


@pytest.mark.asyncio
async def test_history_resets_for_new_run_on_same_id():
    bus = EventBus()

    await bus.publish("vid", _ev("ingest"))
    await bus.publish("vid", _ev("done", 1.0))
    # New run for the same id should not stack on top of the old history.
    await bus.publish("vid", _ev("ingest"))

    seen: list[str] = []

    async def consume() -> None:
        async for ev in bus.subscribe("vid"):
            seen.append(ev.step)
            if ev.step == "done":
                return

    task = asyncio.create_task(consume())
    await asyncio.sleep(0)
    await bus.publish("vid", _ev("done", 1.0))
    await asyncio.wait_for(task, timeout=2.0)

    assert seen == ["ingest", "done"]
