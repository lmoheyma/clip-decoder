# Design System Migration SP3 — Pipeline Live Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated 3-column "pipeline live" experience that takes over `/report/{id}` while the pipeline runs, replacing the SP2-reskinned `PipelineStatus` loading state. Adds per-frame and per-candidate SSE events backend-side, plus 9 new frontend components.

**Architecture:** Backend gains 2 new SSE event types (`vision_frame`, `crossref_candidate`) emitted via callbacks passed to `frame_analyzer.analyze()` and `ref_proposer.propose()`; existing `ingest` and `shots` event payloads enriched. Frontend extracts the SP2 report body into `ReportContent`, then introduces `PipelinePage` (a 9-component composition) and a slim router in `page.tsx`. SSE deduplication added to `lib/api.ts` (required — current code has none).

**Tech Stack:** FastAPI + sse-starlette (backend SSE), Pydantic, Next.js 15 App Router, React 19, TypeScript, Vitest, plain CSS component classes (no new tooling).

**Spec:** [docs/superpowers/specs/2026-05-12-design-system-migration-sp3-design.md](../specs/2026-05-12-design-system-migration-sp3-design.md)

---

## Notes for the implementer

**Real-time work + significant refactor.** The plan combines (a) backend SSE additions that need careful payload shape design, (b) frontend visual reskin into 9 new components, and (c) an atomic-style refactor that splits the SP2 page into router + content.

**TDD where applicable**: backend callback additions + orchestrator events have clear unit tests. Frontend visual components (NowFrame, LogPane, etc.) have minimal tests — they consume typed inputs covered elsewhere. The dedup helper, pipelineStats utility, and KeyframeStrip have dedicated tests.

**Docker dev stack** running with the dev override (verify port + dev mode at Prerequisites):
- `clip-decoder-backend-1` — uvicorn `--reload`, app source bind-mounted
- `clip-decoder-frontend-1` — Next.js dev server, source bind-mounted

**Commands** (no local pnpm — use docker exec):
- Backend tests: `docker exec clip-decoder-backend-1 python -m pytest -q`
- Backend single file: `docker exec clip-decoder-backend-1 python -m pytest tests/unit/test_orchestrator.py -v`
- Frontend type-check: `docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit`
- Frontend tests: `docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run`
- Frontend single file: `docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run components/pipeline/KeyframeStrip`

**Skip the flaky e2e test** when running full backend suite: `--ignore=tests/integration/test_e2e.py` (it downloads a real YouTube clip — environmental, not a regression).

**Reference files** at the repo root (untracked, kept as authoring source):
- `index.html` lines 740–902 — pipeline mockup
- `styles.css` — design system reference

---

## Prerequisites

Before starting Task 1:

```bash
cd /home/louis/clip-decoder
git checkout main
git pull --ff-only
git checkout -b feature/design-system-sp3
```

Verify Docker dev mode is active (bind mounts for hot reload):

```bash
docker ps --filter name=clip-decoder --format '{{.Names}}\t{{.Status}}'
```
Expected: both `clip-decoder-backend-1` and `clip-decoder-frontend-1` running. If not, restart with dev override:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Baseline tests:

```bash
docker exec clip-decoder-backend-1 python -m pytest -q --ignore=tests/integration/test_e2e.py
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: backend ~59 passed, frontend ~16 passed (numbers from end of SP2). If anything fails before changes, STOP and investigate.

---

### Task 1: Extend frame_analyzer.analyze() with on_frame callback

**Files:**
- Modify: `backend/app/pipeline/frame_analyzer.py`
- Modify: `backend/tests/unit/test_frame_analyzer.py`

**Why:** The orchestrator (Task 3) needs to emit one SSE event per analyzed frame. Adding an optional `on_frame` callback to `analyze()` is the cleanest way — preserves existing call sites and existing `on_progress` callback.

- [ ] **Step 1: Write the failing test**

Append to `/home/louis/clip-decoder/backend/tests/unit/test_frame_analyzer.py`:

```python
async def test_on_frame_callback_called_for_each_frame(tmp_path: Path):
    img = tmp_path / "shot_00.jpg"
    shutil.copy(_FIXTURE_JPG, img)
    keyframes = [
        KeyFrame(shot_id="shot_00", timestamp_s=2.5, frame_path=img),
        KeyFrame(shot_id="shot_01", timestamp_s=8.5, frame_path=img),
        KeyFrame(shot_id="shot_02", timestamp_s=14.5, frame_path=img),
    ]
    fake_response = {
        "composition": "x",
        "palette": ["red"],
        "camera_move": "static",
        "costume_setting": "x",
        "distinctive_features": [],
        "raw_description": "x",
        "confidence_in_observation": 0.5,
    }
    nim = AsyncMock()
    nim.analyze_image.return_value = fake_response

    calls: list[tuple[str, int, int]] = []

    async def on_frame(fa, index, total):
        calls.append((fa.frame_id, index, total))

    fa = FrameAnalyzer(nim_client=nim, model="m", concurrency=2)
    await fa.analyze(keyframes, on_frame=on_frame)

    assert len(calls) == 3
    for _, _, total in calls:
        assert total == 3
    # Each frame_id present exactly once
    assert {c[0] for c in calls} == {"shot_00", "shot_01", "shot_02"}
    # Each index in 1..3 present
    assert sorted(c[1] for c in calls) == [1, 2, 3]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker exec clip-decoder-backend-1 python -m pytest tests/unit/test_frame_analyzer.py::test_on_frame_callback_called_for_each_frame -v
```
Expected: fail with `TypeError: analyze() got an unexpected keyword argument 'on_frame'`.

- [ ] **Step 3: Implement the callback parameter**

Edit `/home/louis/clip-decoder/backend/app/pipeline/frame_analyzer.py`. Add the import at the top:

```python
from __future__ import annotations
import asyncio
from typing import Awaitable, Callable, Iterable
```

(Already imports `Awaitable`, `Callable`, `Iterable` — verify, no change needed if present.)

Replace the existing `analyze()` method with:

```python
    async def analyze(
        self,
        keyframes: Iterable[KeyFrame],
        on_frame: Callable[["FrameAnalysis", int, int], Awaitable[None]] | None = None,
    ) -> list[FrameAnalysis]:
        kfs = list(keyframes)
        results: list[FrameAnalysis] = [None] * len(kfs)  # type: ignore[list-item]
        completed = 0
        total = len(kfs)

        async def worker(i: int, kf: KeyFrame) -> None:
            nonlocal completed
            results[i] = await self._one(kf)
            completed += 1
            if on_frame:
                await on_frame(results[i], completed, total)
            if self._on_progress:
                await self._on_progress(completed, total)

        await asyncio.gather(*(worker(i, kf) for i, kf in enumerate(kfs)))
        return results
```

(Only change: add `on_frame=None` param + call it inside `worker` before `_on_progress`.)

- [ ] **Step 4: Run the new test + full frame_analyzer suite**

```bash
docker exec clip-decoder-backend-1 python -m pytest tests/unit/test_frame_analyzer.py -v
```
Expected: 3 tests pass (existing 2 + new 1).

- [ ] **Step 5: Run full backend suite**

```bash
docker exec clip-decoder-backend-1 python -m pytest -q --ignore=tests/integration/test_e2e.py
```
Expected: all green, 1 new test added (was 59, now 60).

- [ ] **Step 6: Commit**

```bash
cd /home/louis/clip-decoder
git add backend/app/pipeline/frame_analyzer.py backend/tests/unit/test_frame_analyzer.py
git commit -m "feat(backend): add on_frame callback to FrameAnalyzer.analyze()"
```

---

### Task 2: Extend ref_proposer.propose() with on_candidate callback

**Files:**
- Modify: `backend/app/pipeline/ref_proposer.py`
- Modify: `backend/tests/unit/test_ref_proposer.py`

**Why:** Each merged candidate becomes a `crossref_candidate` SSE event in Task 3. The callback fires after `_merge(pass1, pass2)` so dedup happens first.

- [ ] **Step 1: Write the failing test**

Read the existing `test_ref_proposer.py` to understand the existing mocking pattern (which uses `_call` patch or `nim.complete_text` mock). Append a test that follows the same pattern:

```python
async def test_on_candidate_callback_called_for_each_merged_candidate(monkeypatch):
    """on_candidate is invoked once per merged ReferenceCandidate."""
    proposer = RefProposer(nim_client=AsyncMock(), model="m")

    fake_pass1 = [
        ReferenceCandidate(
            timestamp_s=10.0, source_frame_id="shot_01",
            work_title="A", work_creator="X", work_year=2000,
            work_type="painting", reasoning="r", raw_confidence=0.8,
        ),
        ReferenceCandidate(
            timestamp_s=20.0, source_frame_id="shot_02",
            work_title="B", work_creator="Y", work_year=2001,
            work_type="film", reasoning="r", raw_confidence=0.7,
        ),
    ]

    async def fake_call(template, ctx):
        return fake_pass1 if "types_covered" not in ctx else []

    monkeypatch.setattr(proposer, "_call", fake_call)

    received: list[str] = []
    async def on_candidate(c):
        received.append(c.work_title)

    out = await proposer.propose(
        title="t", channel="c", lyrics_text="",
        frame_analyses=[], on_candidate=on_candidate,
    )

    assert len(out) == 2
    assert received == ["A", "B"]
```

(Adjust import for `ReferenceCandidate` to match existing test file imports.)

- [ ] **Step 2: Run test to verify it fails**

```bash
docker exec clip-decoder-backend-1 python -m pytest tests/unit/test_ref_proposer.py::test_on_candidate_callback_called_for_each_merged_candidate -v
```
Expected: fail with `TypeError: propose() got an unexpected keyword argument 'on_candidate'`.

- [ ] **Step 3: Add the callback parameter to propose()**

Edit `/home/louis/clip-decoder/backend/app/pipeline/ref_proposer.py`. The current `propose()` signature uses `*` for keyword-only args (around line 73). Modify:

```python
    async def propose(
        self,
        *,
        title: str,
        channel: str,
        lyrics_text: str,
        frame_analyses: list[FrameAnalysis],
        on_candidate: Callable[[ReferenceCandidate], Awaitable[None]] | None = None,
    ) -> list[ReferenceCandidate]:
        base_ctx = {
            "title": _escape_braces(title or "(unknown)"),
            "channel": _escape_braces(channel or "(unknown)"),
            "lyrics": _escape_braces(lyrics_text or "(none)"),
            "frame_summaries": _format_frame_summaries(frame_analyses),
        }
        pass1 = await self._call(self._tpl_general, base_ctx)

        types_covered = ", ".join(sorted({c.work_type for c in pass1})) or "(none)"
        try:
            pass2 = await self._call(
                self._tpl_complement,
                {**base_ctx, "types_covered": _escape_braces(types_covered)},
            )
        except Exception as e:
            logger.warning(
                "ref proposer pass 2 failed (%s) — keeping pass 1 only", e,
            )
            pass2 = []

        merged = _merge(pass1, pass2)
        if on_candidate:
            for c in merged:
                await on_candidate(c)
        return merged
```

Add `Awaitable, Callable` to the imports at the top (if not already there). Check existing imports first.

- [ ] **Step 4: Run the new test + full ref_proposer suite**

```bash
docker exec clip-decoder-backend-1 python -m pytest tests/unit/test_ref_proposer.py -v
```
Expected: all existing tests + the new one pass.

- [ ] **Step 5: Run full backend suite**

```bash
docker exec clip-decoder-backend-1 python -m pytest -q --ignore=tests/integration/test_e2e.py
```
Expected: all green (was 60, now 61).

- [ ] **Step 6: Commit**

```bash
git add backend/app/pipeline/ref_proposer.py backend/tests/unit/test_ref_proposer.py
git commit -m "feat(backend): add on_candidate callback to RefProposer.propose()"
```

---

### Task 3: Enrich orchestrator events (ingest + shots payloads, emit vision_frame + crossref_candidate)

**Files:**
- Modify: `backend/app/pipeline/orchestrator.py`
- Modify: `backend/tests/unit/test_orchestrator.py`

**Why:** This is the orchestrator change that uses Tasks 1 and 2 to actually emit the new SSE events into the bus. Also enriches the existing `ingest` and `shots` payloads.

- [ ] **Step 1: Write the 3 failing tests**

Read `/home/louis/clip-decoder/backend/tests/unit/test_orchestrator.py` first to find the existing test pattern (how it instantiates Orchestrator, mocks subcomponents, captures emitted events). Then append:

```python
async def test_ingest_event_includes_clip_metadata(orch_with_fakes, captured_events):
    """ingest event payload includes title, channel, duration_s, captions_count."""
    await orch_with_fakes.run("https://www.youtube.com/watch?v=test")
    ingest_events = [e for e in captured_events if e.step == "ingest"]
    assert len(ingest_events) >= 1
    payload = ingest_events[0].payload
    assert "title" in payload
    assert "channel" in payload
    assert "duration_s" in payload
    assert "captions_count" in payload


async def test_shots_event_includes_keyframes_list(orch_with_fakes, captured_events):
    """shots event payload includes shot_count and keyframes [{shot_id, timestamp_s}]."""
    await orch_with_fakes.run("https://www.youtube.com/watch?v=test")
    shots_events = [e for e in captured_events if e.step == "shots"]
    assert len(shots_events) >= 1
    payload = shots_events[0].payload
    assert "shot_count" in payload
    assert "keyframes" in payload
    assert isinstance(payload["keyframes"], list)
    assert len(payload["keyframes"]) == payload["shot_count"]
    for kf in payload["keyframes"]:
        assert "shot_id" in kf
        assert "timestamp_s" in kf


async def test_vision_frame_events_emitted_per_frame(orch_with_fakes, captured_events):
    """One vision_frame event is emitted per analyzed frame, with full payload."""
    await orch_with_fakes.run("https://www.youtube.com/watch?v=test")
    vf_events = [e for e in captured_events if e.step == "vision_frame"]
    assert len(vf_events) >= 1
    payload = vf_events[0].payload
    for key in ("frame_id", "timestamp_s", "shot_index", "total_shots",
                "raw_description", "composition", "palette_hex"):
        assert key in payload, f"Missing key: {key}"
    # shot_index is 1-based and <= total_shots
    for ev in vf_events:
        assert 1 <= ev.payload["shot_index"] <= ev.payload["total_shots"]
```

The `orch_with_fakes` and `captured_events` fixtures may already exist — check the existing test file. If not, you'll need to add fixtures that wire an Orchestrator with mocked Ingestor / ShotSampler / FrameAnalyzer / RefProposer / Verifier producing minimal valid outputs (2-3 keyframes is enough), plus an EventBus capture subscriber. Match the existing test pattern exactly.

If the existing tests use a different shape entirely (e.g., direct event capture with a list), adapt the assertions to that pattern. The key invariants to assert remain: `ingest` payload has 4 fields, `shots` payload has `keyframes` list, `vision_frame` events emitted N times.

- [ ] **Step 2: Run the failing tests**

```bash
docker exec clip-decoder-backend-1 python -m pytest tests/unit/test_orchestrator.py -v -k "metadata or keyframes_list or vision_frame"
```
Expected: all 3 fail. Different failure modes possible: assertion failure on missing keys, or `KeyError` accessing payload fields that don't exist.

- [ ] **Step 3: Modify the orchestrator**

Open `/home/louis/clip-decoder/backend/app/pipeline/orchestrator.py`. Replace the `run()` method body with the enriched version. The diff is in three places:

**Diff 1 — enrich the `ingest` event** (replace the existing emit, around line 57):

```python
        await self._emit(
            yid, "ingest",
            f"Downloaded '{ingest.title}'",
            progress=0.1,
            payload={
                "title": ingest.title,
                "channel": ingest.channel,
                "duration_s": ingest.duration_s,
                "captions_count": len(ingest.captions),
            },
        )
```

**Diff 2 — enrich the `shots` event** (replace around line 60-63):

```python
        keyframes = self._sampler.sample(ingest.video_path, youtube_id=yid)
        await self._emit(
            yid, "shots",
            f"Detected {len(keyframes)} shots",
            progress=0.2,
            payload={
                "shot_count": len(keyframes),
                "keyframes": [
                    {"shot_id": kf.shot_id, "timestamp_s": kf.timestamp_s}
                    for kf in keyframes
                ],
            },
        )
```

**Diff 3 — wire callbacks and emit vision_frame + crossref_candidate** (replace lines 65-81, the vision + crossref sections):

```python
        # Vision pass — per-frame events via on_frame callback.
        # shot_index is 1-based for display; fa.frame_id is the 0-padded
        # zero-indexed string from shot_sampler ("shot_03" -> shot_index=4).
        async def _on_vision_frame(fa, index: int, total: int) -> None:
            msg = fa.raw_description[:80] + ("…" if len(fa.raw_description) > 80 else "")
            await self._emit(
                yid, "vision_frame",
                msg,
                progress=0.25 + (index / total) * 0.30,
                payload={
                    "frame_id": fa.frame_id,
                    "timestamp_s": fa.timestamp_s,
                    "shot_index": index,
                    "total_shots": total,
                    "raw_description": fa.raw_description,
                    "composition": fa.composition,
                    "palette_hex": fa.palette_hex,
                },
            )

        await self._emit(yid, "vision", "Analyzing frames", 0.25)
        frame_analyses = await self._frame_analyzer.analyze(
            keyframes, on_frame=_on_vision_frame
        )
        await self._emit(
            yid, "vision", f"Analyzed {len(frame_analyses)} frames", 0.55
        )

        # Cross-ref pass — per-candidate events via on_candidate callback.
        async def _on_candidate(c) -> None:
            await self._emit(
                yid, "crossref_candidate",
                f"{c.work_title} / {c.work_creator}",
                progress=0.65,
                payload={
                    "source_frame_id": c.source_frame_id,
                    "timestamp_s": c.timestamp_s,
                    "work_title": c.work_title,
                    "work_creator": c.work_creator,
                    "work_year": c.work_year,
                    "work_type": c.work_type,
                    "raw_confidence": c.raw_confidence,
                },
            )

        await self._emit(yid, "crossref", "Cross-referencing", 0.6)
        lyrics = " ".join(c.text for c in ingest.captions)
        candidates = await self._ref_proposer.propose(
            title=ingest.title,
            channel=ingest.channel,
            lyrics_text=lyrics,
            frame_analyses=frame_analyses,
            on_candidate=_on_candidate,
        )
        await self._emit(
            yid, "crossref", f"Proposed {len(candidates)} candidates", 0.7
        )
```

The remaining `verify` / `done` / `error` paths are unchanged.

- [ ] **Step 4: Run the new tests**

```bash
docker exec clip-decoder-backend-1 python -m pytest tests/unit/test_orchestrator.py -v -k "metadata or keyframes_list or vision_frame"
```
Expected: all 3 pass.

- [ ] **Step 5: Run full backend suite**

```bash
docker exec clip-decoder-backend-1 python -m pytest -q --ignore=tests/integration/test_e2e.py
```
Expected: all green (was 61, now 64).

- [ ] **Step 6: Commit**

```bash
git add backend/app/pipeline/orchestrator.py backend/tests/unit/test_orchestrator.py
git commit -m "feat(backend): emit per-frame vision_frame and per-candidate crossref_candidate SSE events; enrich ingest+shots payloads"
```

---

### Task 4: Tune EventBus replay pace for high-volume runs

**Files:**
- Modify: `backend/app/api/sse.py`

**Why:** With ~100 events per run (80 vision_frame + 10 crossref_candidate + 10 transitions), the existing `_REPLAY_PACE_S = 0.18s` makes a reload-mid-pipeline take ~18s to replay. Adaptive pacing: fast for the bursty per-frame/per-candidate events, slow for the transition events users actually need to perceive sequentially.

- [ ] **Step 1: Read the existing EventBus**

Read `/home/louis/clip-decoder/backend/app/api/sse.py`. Locate the `subscribe()` method's replay loop (around line 60-64):

```python
for i, ev in enumerate(backlog):
    yield ev
    if i < len(backlog) - 1:
        await asyncio.sleep(self._REPLAY_PACE_S)
```

- [ ] **Step 2: Modify subscribe() to use adaptive pace**

Replace the constant `_REPLAY_PACE_S = 0.18` with two constants and modify the loop:

In the class body, replace:
```python
    _REPLAY_PACE_S: float = 0.18
```

With:
```python
    # Slow pace for transitions (user perceives them as the pipeline progressing).
    _REPLAY_PACE_TRANSITION_S: float = 0.18
    # Fast pace for bursty per-frame/per-candidate events (avoid 80×0.18s = 14s replay).
    _REPLAY_PACE_BURST_S: float = 0.02
    # Steps that fire in bursts during a run.
    _BURST_STEPS: frozenset[str] = frozenset({"vision_frame", "crossref_candidate"})
```

In `subscribe()`, replace the replay loop with:
```python
            for i, ev in enumerate(backlog):
                yield ev
                if i < len(backlog) - 1:
                    pace = (
                        self._REPLAY_PACE_BURST_S
                        if ev.step in self._BURST_STEPS
                        else self._REPLAY_PACE_TRANSITION_S
                    )
                    await asyncio.sleep(pace)
```

- [ ] **Step 3: Run existing SSE tests + full backend suite**

```bash
docker exec clip-decoder-backend-1 python -m pytest tests/unit/test_sse_bus.py -v
docker exec clip-decoder-backend-1 python -m pytest -q --ignore=tests/integration/test_e2e.py
```
Expected: all green. Existing replay tests (if any) still pass because they don't pin to the constant value.

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/sse.py
git commit -m "perf(backend): adaptive replay pace in EventBus (fast for bursty steps)"
```

---

### Task 5: Extend frontend types.ts with new step + payload interfaces

**Files:**
- Modify: `frontend/lib/types.ts`

**Why:** Frontend code in subsequent tasks needs typed access to the new step strings + payload shapes. Done first so every later component imports from a stable types module.

- [ ] **Step 1: Replace `frontend/lib/types.ts`**

Open the file and replace the `PipelineStep` type + add new payload interfaces:

```typescript
export type Verdict = "keep" | "speculative" | "reject";
export type Confidence = "confirmed" | "speculative" | "hidden";

export interface VerifiedReference {
  timestamp_s: number;
  source_frame_id: string;
  work_title: string;
  work_creator: string;
  work_year: number | null;
  work_type: string;
  reasoning: string;
  raw_confidence: number;
  verdict: Verdict;
  final_confidence: Confidence;
  supporting_elements: string[];
  wikipedia_url: string | null;
  wikipedia_thumbnail_url?: string | null;
}

export interface FrameAnalysis {
  timestamp_s: number;
  frame_id: string;
  composition: string;
  palette: string[];
  palette_hex?: string[];
  camera_move: string;
  costume_setting: string;
  distinctive_features: string[];
  raw_description: string;
  confidence_in_observation: number;
}

export interface Report {
  youtube_id: string;
  title: string;
  channel: string;
  duration_s: number;
  references: VerifiedReference[];
  frame_analyses: FrameAnalysis[];
  created_at?: string;
}

export type PipelineStep =
  | "ingest"
  | "shots"
  | "vision"
  | "vision_frame"
  | "crossref"
  | "crossref_candidate"
  | "verify"
  | "done"
  | "error";

export interface PipelineEvent {
  step: PipelineStep;
  message: string;
  progress: number;
  payload: Record<string, unknown>;
}

// Typed payload narrowers — consumers use these after step-checking the event.
export interface IngestPayload {
  title: string;
  channel: string;
  duration_s: number;
  captions_count: number;
}

export interface ShotsPayload {
  shot_count: number;
  keyframes: { shot_id: string; timestamp_s: number }[];
}

export interface VisionFramePayload {
  frame_id: string;
  timestamp_s: number;
  shot_index: number;
  total_shots: number;
  raw_description: string;
  composition: string;
  palette_hex: string[];
}

export interface CrossrefCandidatePayload {
  source_frame_id: string;
  timestamp_s: number;
  work_title: string;
  work_creator: string;
  work_year: number | null;
  work_type: string;
  raw_confidence: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
```
Expected: zero errors. (Existing imports of `PipelineStep`, `PipelineEvent` still work — the union just gained new members.)

- [ ] **Step 3: Run frontend tests**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: all 16 tests pass (no regression).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts
git commit -m "feat(frontend): extend PipelineStep union + add typed payload interfaces"
```

---

### Task 6: Add SSE deduplication in subscribePipeline + register new step names

**Files:**
- Modify: `frontend/lib/api.ts`

**Why:** `subscribePipeline` currently has zero deduplication. EventSource auto-reconnect on connection drop redispatches the entire `_history` backlog → duplicate log lines / candidate cards on the frontend. **Required fix per spec.** Also: new step names (`vision_frame`, `crossref_candidate`) must be added to the event listener registration.

- [ ] **Step 1: Replace `subscribePipeline` in `frontend/lib/api.ts`**

Replace the existing function with:

```typescript
export function subscribePipeline(
  youtubeId: string,
  onEvent: (e: PipelineEvent) => void,
  onError?: (err: unknown) => void,
): () => void {
  const es = new EventSource(`/api/stream/${encodeURIComponent(youtubeId)}`);
  // Steps that map to named SSE events emitted by the backend.
  const stepNames: PipelineEvent["step"][] = [
    "ingest", "shots", "vision", "vision_frame",
    "crossref", "crossref_candidate", "verify", "done", "error",
  ];
  // Deduplication: on EventSource auto-reconnect, the backend replays the
  // full history. Track event identities so duplicates don't push to React state.
  const seen = new Set<string>();
  function eventKey(e: PipelineEvent): string {
    // Identity: step + the most-discriminating payload field if present.
    const p = e.payload as Record<string, unknown>;
    const id =
      (p?.frame_id as string | undefined) ??
      (p?.work_title as string | undefined) ??
      (p?.source_frame_id as string | undefined) ??
      e.message;
    return `${e.step}:${id}:${e.progress}`;
  }
  for (const step of stepNames) {
    es.addEventListener(step, (raw) => {
      try {
        const data = JSON.parse((raw as MessageEvent).data) as PipelineEvent;
        const key = eventKey(data);
        if (seen.has(key)) return;  // skip duplicates from reconnect replay
        seen.add(key);
        onEvent(data);
        if (data.step === "done" || data.step === "error") es.close();
      } catch (err) {
        onError?.(err);
      }
    });
  }
  es.onerror = (err) => onError?.(err);
  return () => es.close();
}
```

- [ ] **Step 2: Verify TypeScript + tests**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: zero TS errors, 16 tests still pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(frontend): dedup SSE events in subscribePipeline + register new step names"
```

---

### Task 7: Create pipelineStats helper + 3 TDD tests

**Files:**
- Create: `frontend/lib/pipelineStats.ts`
- Create: `frontend/lib/pipelineStats.test.ts`

**Why:** `PipelineList` (Task 12) needs a pure function to classify the 5 pipeline steps as `pending` / `active` / `done` / `error` with their progress + fraction. Pure derivation, easy to test. Replaces the `classify()` function buried in the old `PipelineStatus.tsx` (deleted in Task 18).

- [ ] **Step 1: Write the 3 failing tests**

Create `/home/louis/clip-decoder/frontend/lib/pipelineStats.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifySteps } from "./pipelineStats";
import type { PipelineEvent } from "./types";

function ev(step: PipelineEvent["step"], progress = 0, payload = {}): PipelineEvent {
  return { step, message: "", progress, payload };
}

describe("classifySteps", () => {
  it("returns all pending when no events", () => {
    const steps = classifySteps([]);
    expect(steps).toHaveLength(5);
    for (const s of steps) {
      expect(s.status).toBe("pending");
      expect(s.progress).toBe(0);
    }
  });

  it("marks vision active with partial frame count", () => {
    const steps = classifySteps([
      ev("ingest", 0.1),
      ev("shots", 0.2, { shot_count: 62 }),
      ev("vision", 0.25),
      ev("vision_frame", 0.40, { shot_index: 34, total_shots: 62 }),
    ]);
    const ingest = steps.find((s) => s.key === "ingest")!;
    const shots = steps.find((s) => s.key === "shots")!;
    const vision = steps.find((s) => s.key === "vision")!;
    const crossref = steps.find((s) => s.key === "crossref")!;
    expect(ingest.status).toBe("done");
    expect(shots.status).toBe("done");
    expect(vision.status).toBe("active");
    expect(vision.fraction).toBe("34 / 62");
    expect(crossref.status).toBe("pending");
  });

  it("marks all done when done event seen", () => {
    const steps = classifySteps([
      ev("ingest", 0.1),
      ev("shots", 0.2),
      ev("vision", 0.55),
      ev("crossref", 0.7),
      ev("verify", 0.9),
      ev("done", 1.0),
    ]);
    for (const s of steps) {
      expect(s.status).toBe("done");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run lib/pipelineStats
```
Expected: fails with module resolution error.

- [ ] **Step 3: Implement `pipelineStats.ts`**

Create `/home/louis/clip-decoder/frontend/lib/pipelineStats.ts`:

```typescript
import type { PipelineEvent } from "./types";

export type StepStatus = "pending" | "active" | "done" | "error";

export interface StepInfo {
  key: "ingest" | "shots" | "vision" | "crossref" | "verify";
  label: string;
  status: StepStatus;
  progress: number;   // 0..1 within this step's band
  fraction: string;   // "34 / 62" or "done" or "pending"
}

interface Band {
  key: StepInfo["key"];
  label: string;
  floor: number;
  ceiling: number;
}

const BANDS: Band[] = [
  { key: "ingest",   label: "Ingest",    floor: 0.00, ceiling: 0.10 },
  { key: "shots",    label: "Shots",     floor: 0.10, ceiling: 0.20 },
  { key: "vision",   label: "Vision",    floor: 0.20, ceiling: 0.55 },
  { key: "crossref", label: "Cross-ref", floor: 0.55, ceiling: 0.70 },
  { key: "verify",   label: "Verify",    floor: 0.70, ceiling: 1.00 },
];

export function classifySteps(events: PipelineEvent[]): StepInfo[] {
  const seen = new Set(events.map((e) => e.step));
  const finished = seen.has("done");
  const failed = seen.has("error");
  const overall = events.length ? Math.max(...events.map((e) => e.progress ?? 0)) : 0;

  // Per-step rich data derived from specific events.
  const visionFrameCount = events.filter((e) => e.step === "vision_frame").length;
  const latestVisionFrame = [...events].reverse().find((e) => e.step === "vision_frame");
  const totalShots = (latestVisionFrame?.payload as { total_shots?: number } | undefined)
    ?.total_shots
    ?? (events.find((e) => e.step === "shots")?.payload as { shot_count?: number } | undefined)
    ?.shot_count;
  const crossrefCandidates = events.filter((e) => e.step === "crossref_candidate").length;

  return BANDS.map<StepInfo>((band) => {
    let status: StepStatus = "pending";
    let fraction = "pending";
    let progress = 0;

    if (finished) {
      status = "done";
      fraction = "done";
      progress = 1;
    } else if (failed && overall < band.ceiling) {
      status = "error";
      fraction = "error";
    } else if (overall >= band.ceiling - 1e-6) {
      status = "done";
      fraction = "done";
      progress = 1;
    } else if (overall > band.floor || seen.has(band.key)) {
      status = "active";
      const span = band.ceiling - band.floor;
      progress = Math.min(1, Math.max(0, (overall - band.floor) / span));
    }

    // Rich fractions per step:
    if (band.key === "shots" && status === "done") {
      const sc = (events.find((e) => e.step === "shots")?.payload as { shot_count?: number } | undefined)?.shot_count;
      if (typeof sc === "number") fraction = `${sc} / ${sc}`;
    }
    if (band.key === "vision" && status === "active" && typeof totalShots === "number") {
      fraction = `${visionFrameCount} / ${totalShots}`;
    }
    if (band.key === "vision" && status === "done") {
      fraction = totalShots ? `${totalShots} / ${totalShots}` : "done";
    }
    if (band.key === "crossref" && status === "active") {
      fraction = `${crossrefCandidates} found`;
    }
    if (band.key === "crossref" && status === "done") {
      fraction = `${crossrefCandidates} candidates`;
    }

    return { key: band.key, label: band.label, status, progress, fraction };
  });
}
```

- [ ] **Step 4: Run tests + full suite**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run lib/pipelineStats
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: 3 new tests pass + 16 existing tests = 19 total.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/pipelineStats.ts frontend/lib/pipelineStats.test.ts
git commit -m "feat(frontend): add pipelineStats helper with classifySteps + 3 TDD tests"
```

---

### Task 8: Add SP3 CSS block to globals.css

**Files:**
- Modify: `frontend/app/globals.css`

**Why:** All new pipeline components need their CSS classes available. Doing CSS first means every later component task immediately has working visuals — no "blank" iterations.

- [ ] **Step 1: Locate the insertion point**

Open `/home/louis/clip-decoder/frontend/app/globals.css`. Find the end of the SP2 block (search for `SP2 — Report-specific components` header, then scroll to the end of that block, just before the legacy `Surface treatments` section starts).

- [ ] **Step 2: Append the SP3 block**

Insert this block immediately before the `Surface treatments` legacy section:

```css
/* ─────────────────────────────────────────────────────────────────
   SP3 — Pipeline live page components.
   3-column stage, clip metadata, pipeline rows, now frame, keyframe
   strip, log pane, candidates pane, footer slate.
   ───────────────────────────────────────────────────────────────── */

/* ─── Stage layout ───────────────────────────── */
.pipeline-stage {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
  padding: 0 clamp(32px, 5vw, 64px) 32px;
}
@media (min-width: 1024px) {
  .pipeline-stage { grid-template-columns: 350px 1fr 320px; }
}
.pipeline-col-left, .pipeline-col-center, .pipeline-col-right {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pipeline-h2 {
  font-size: clamp(40px, 5vw, 72px);
  line-height: 0.96;
  margin: 0 0 24px;
  color: var(--ink);
}

/* ─── Clip metadata pane ─────────────────────── */
.clip-meta {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
}
.clip-meta > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.clip-meta dt {
  font-family: var(--sans);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--muted);
  font-weight: 500;
}
.clip-meta dd {
  margin: 0;
  font-family: var(--sans);
  font-size: 14px;
  color: var(--body-strong);
}
.clip-meta dd.mono { font-family: var(--sans); letter-spacing: 0.1em; }
.clip-meta dd.serif { font-family: var(--serif); font-size: 18px; font-style: italic; }

/* ─── Pipeline rows (left col lower) ─────────── */
.pipeline-list {
  border: 1px solid var(--hairline);
  background: var(--canvas-soft);
  border-radius: var(--r-2);
  padding: 4px 16px;
}
.pipeline-row {
  display: flex;
  align-items: center;
  gap: 20px;
  font-family: var(--sans);
  font-size: 15px;
  padding: 16px 0;
  color: var(--ink);
  border-bottom: 1px solid var(--hairline);
}
.pipeline-row:last-child { border-bottom: 0; }
.pipeline-row .pill {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  width: 180px;
  font-weight: 500;
  font-size: 15px;
  color: var(--ink);
}
.pipeline-row .pill .num {
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--muted);
  width: 24px;
}
.pipeline-row .pill em { font-style: normal; }
.pipeline-row .progress {
  flex: 1;
  height: 2px;
  background: var(--hairline);
  border-radius: var(--r-pill);
  overflow: hidden;
  position: relative;
}
.pipeline-row .progress i {
  display: block;
  height: 100%;
  background: var(--ink);
  border-radius: var(--r-pill);
}
.pipeline-row.done .progress i { background: var(--body); }
.pipeline-row.error .progress i { background: var(--error); }
.pipeline-row .frac {
  color: var(--body);
  min-width: 90px;
  text-align: right;
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 500;
}
.pipeline-row.done .frac { color: var(--muted); }
.pipeline-row.active .pill em { color: var(--ink); }
.pipeline-row:not(.done):not(.active):not(.error) .pill em { color: var(--muted); }
.pipeline-row:not(.done):not(.active):not(.error) .pill .num { color: var(--muted-soft); }

/* ─── Now frame (center upper) ──────────────── */
.now {
  position: relative;
  aspect-ratio: 16/9;
  width: 100%;
  border-radius: var(--r-2);
  overflow: hidden;
  background: var(--surface-strong);
}
.now img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.now.vignette { box-shadow: inset 0 0 80px rgba(0, 0, 0, 0.7); }
.now .scan {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--grad-peach), transparent);
  animation: scan-down 3s linear infinite;
  pointer-events: none;
}
@keyframes scan-down {
  from { top: 0%; }
  to { top: 100%; }
}
.now .crosshair {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.3;
  pointer-events: none;
}
.now .label {
  position: absolute;
  top: 12px;
  left: 12px;
  padding: 4px 10px;
  background: rgba(0, 0, 0, 0.6);
  font-family: var(--sans);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--ink);
  border-radius: 4px;
}
.now .meta-overlay {
  position: absolute;
  bottom: 12px;
  left: 12px;
  right: 12px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-family: var(--sans);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--ink);
}
.now .meta-overlay > span {
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 4px;
}
.now-palette {
  display: flex;
  gap: 4px;
  height: 16px;
  margin-top: 8px;
}
.now-palette span {
  flex: 1;
  border-radius: 4px;
}

/* ─── Keyframe strip (center middle) ─────────── */
.strip-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.strip-row .lbl {
  display: flex;
  justify-content: space-between;
  font-family: var(--sans);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--muted);
}
.strip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
  scroll-behavior: smooth;
}
.cell {
  flex-shrink: 0;
  width: 90px;
  height: 60px;
  position: relative;
  background: var(--surface-strong);
  border-radius: var(--r-1);
  overflow: hidden;
  border: 2px solid transparent;
}
.cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cell .tc {
  position: absolute;
  bottom: 4px;
  left: 4px;
  font-family: var(--sans);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--body);
  padding: 1px 4px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 2px;
}
.cell.pending {
  background: var(--canvas-soft);
}
.cell.pending .tc { color: var(--muted); }
.cell.latest { border-color: var(--grad-peach); }

/* ─── Log pane (center lower) ────────────────── */
.log-pane {
  background: var(--surface-card);
  border: 1px solid var(--hairline);
  border-radius: var(--r-2);
  padding: 16px;
  font-family: var(--sans);
  font-size: 12px;
}
.log-pane h3 {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0 0 12px;
  font-family: var(--sans);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--muted);
  font-weight: 500;
}
.log-pane h3 .live { color: var(--ink); }
.log-pane .log {
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: var(--sans);
  font-size: 12px;
  line-height: 1.5;
}
.log-pane .log > div {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--body);
}
.log-pane .t {
  color: var(--muted);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.log-pane .lvl {
  text-transform: uppercase;
  letter-spacing: 0.96px;
  font-size: 10px;
  color: var(--muted);
  flex-shrink: 0;
  min-width: 56px;
}
.log-pane .lvl.candidate { color: var(--grad-peach); }
.log-pane .lvl.error { color: var(--error); }
.log-pane .v { color: var(--body); }
.log-pane .q { color: var(--body-strong); font-style: italic; }

/* ─── Candidates pane (right col) ─────────────── */
.candidates-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}
.candidate-card {
  background: var(--surface-card);
  border: 1px solid var(--hairline);
  padding: 14px 16px;
  border-radius: var(--r-2);
  opacity: 0;
  animation: candidate-fade-in 0.4s ease forwards;
}
.candidate-card.weak {
  background: var(--surface-card);
  border: 1px dashed color-mix(in oklab, var(--grad-sky) 35%, transparent);
}
@keyframes candidate-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.candidates-empty {
  font-family: var(--sans);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--muted-soft);
  text-align: center;
  padding: 32px 16px;
}
.candidates-footer {
  margin-top: auto;
  border-top: 1px solid var(--hairline);
  padding-top: 14px;
}
.candidates-footer-body {
  font-family: var(--sans);
  font-size: 13px;
  color: var(--body);
  line-height: 1.6;
  margin-top: 8px;
}

/* ─── Footer slate (config) ──────────────────── */
.pipeline-footer-slate {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 16px clamp(32px, 5vw, 64px);
  background: var(--canvas);
  border-top: 1px solid var(--hairline);
  font-family: var(--sans);
  font-size: 13px;
  color: var(--muted);
}
.pipeline-footer-slate .sep {
  flex: 0 0 auto;
  width: 1px;
  height: 14px;
  background: var(--hairline);
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .now .scan { animation: none; display: none; }
  .candidate-card { animation: none; opacity: 1; transform: none; }
}
```

- [ ] **Step 3: Verify CSS doesn't break existing styles**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: zero errors, 19 tests pass.

Browser sanity (if port 3000 is reachable): open `localhost:3000/report/anything` — the SP2 loading state should look unchanged (no new selectors apply yet). If port 3000 is busy with another project, skip this — purely visual check.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(frontend): add SP3 CSS block (pipeline stage, now frame, strip, log, candidates)"
```

---

### Task 9: Extract ReportContent from page.tsx (atomic refactor, no behavior change)

**Files:**
- Create: `frontend/components/report/ReportContent.tsx`
- Modify: `frontend/app/report/[id]/page.tsx`

**Why:** Per the spec's "split into 2 atomic tasks" requirement: this task is **pure code movement**, no behavior change. The SP2 page body (Slate + Header + PlayerRow + FilterBar + Grid + Footer) is extracted into `ReportContent` taking `{ report, youtubeId }` as props. `page.tsx` keeps its existing data-loading and renders `<ReportContent>` once `report` is available.

Task 10 (next) introduces the `PipelinePage` switch — but at the end of Task 9 the app behaves exactly like end-of-SP2.

- [ ] **Step 1: Read the current `page.tsx`**

Open `/home/louis/clip-decoder/frontend/app/report/[id]/page.tsx`. Note all state, hooks, and the rendered JSX inside the success-state branch (`if (!report || !stats) return null; return <main className="frame surface-dark...">...`). This is what becomes `ReportContent`.

- [ ] **Step 2: Create `ReportContent.tsx`**

Create `/home/louis/clip-decoder/frontend/components/report/ReportContent.tsx`:

```tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Confidence,
  FrameAnalysis,
  Report,
  VerifiedReference,
} from "@/lib/types";
import { flagReference } from "@/lib/api";
import { computeReportStats } from "@/lib/reportStats";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";
import { FilterBar } from "@/components/FilterBar";
import { SummaryCard } from "@/components/SummaryCard";
import { ReferenceCard } from "@/components/ReferenceCard";

function formatDuration(s: number): string {
  const t = Math.floor(s);
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "recently";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "recently";
  }
}

export function ReportContent({
  report,
  youtubeId,
}: {
  report: Report;
  youtubeId: string;
}) {
  const [shareToast, setShareToast] = useState(false);
  const playerRef = useRef<VideoPlayerHandle>(null);

  const stats = useMemo(() => computeReportStats(report), [report]);

  const [selectedVerdicts, setSelectedVerdicts] = useState<Set<Confidence>>(
    new Set<Confidence>(["confirmed", "speculative"]),
  );
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (selectedTypes.size === 0 && stats.availableTypes.length > 0) {
      setSelectedTypes(new Set(stats.availableTypes));
    }
  }, [stats, selectedTypes.size]);

  const frameById = useMemo(() => {
    const m = new Map<string, FrameAnalysis>();
    for (const f of report.frame_analyses) m.set(f.frame_id, f);
    return m;
  }, [report]);

  const filteredRefs = useMemo(() => {
    return report.references
      .filter((r) => selectedVerdicts.has(r.final_confidence))
      .filter((r) => selectedTypes.has(r.work_type))
      .sort((a, b) => a.timestamp_s - b.timestamp_s);
  }, [report, selectedVerdicts, selectedTypes]);

  function toggleVerdict(v: Confidence) {
    setSelectedVerdicts((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }
  function toggleType(t: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function jumpTo(ref: VerifiedReference) {
    playerRef.current?.seekTo(ref.timestamp_s);
  }
  async function handleFlag(idx: number) {
    await flagReference(youtubeId, idx);
  }
  async function shareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2000);
    } catch {
      // clipboard unavailable in non-secure context
    }
  }

  function Slate({
    youtubeId,
    duration,
    shots,
    refs,
  }: {
    youtubeId: string;
    duration: number;
    shots: number;
    refs: number;
  }) {
    return (
      <div className="slate">
        <span className="dot" />
        <b>ClipDecoder</b>
        <span className="slate-context">Report</span>
        <span className="sep" />
        <span className="tc">{youtubeId}</span>
        <span className="tc">{formatDuration(duration)}</span>
        <span className="tc">
          {shots} shots · {refs} references
        </span>
        <span className="sep" />
        <button type="button" className="slate-action" onClick={shareLink}>
          {shareToast ? "Link copied" : "Share ↗"}
        </button>
        <a
          className="slate-action"
          href={`/api/report/${youtubeId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Raw JSON
        </a>
      </div>
    );
  }

  return (
    <main className="frame surface-dark relative min-h-screen flex flex-col">
      <Slate
        youtubeId={report.youtube_id}
        duration={report.duration_s}
        shots={stats.shots}
        refs={stats.total}
      />

      <header className="report-header">
        <h1 className="serif-it report-h1">
          A clip you&apos;d<br />like{" "}
          <em
            style={{ color: "var(--grad-lavender)", fontStyle: "italic" }}
          >
            decoded.
          </em>
        </h1>
        <h2 className="serif-it report-title">{report.title}</h2>
        <div className="report-meta">
          <span>{report.channel}</span>
          <span>·</span>
          <span>{formatDuration(report.duration_s)}</span>
          <span>·</span>
          <span>{stats.shots} shots</span>
          <span>·</span>
          <span>Analysed {formatDate(report.created_at)}</span>
          {stats.wikiHits > 0 && (
            <>
              <span>·</span>
              <span>
                Wikipedia verified ({stats.wikiHits}/{stats.total})
              </span>
            </>
          )}
        </div>
      </header>

      <section className="player-row">
        <div className="player-container">
          <VideoPlayer ref={playerRef} youtubeId={report.youtube_id} />
          <p className="hairline">Click any reference card to seek the player</p>
        </div>
        <SummaryCard stats={stats} />
      </section>

      <FilterBar
        verdictCounts={{
          confirmed: stats.confirmed,
          speculative: stats.speculative,
          hidden: stats.hidden,
        }}
        typeCounts={Object.fromEntries(
          stats.typeBreakdown.map((t) => [t.type, t.count]),
        )}
        availableTypes={stats.availableTypes}
        selectedVerdicts={selectedVerdicts}
        selectedTypes={selectedTypes}
        onToggleVerdict={toggleVerdict}
        onToggleType={toggleType}
      />

      <div className="grid">
        {filteredRefs.length === 0 ? (
          <div
            className="hairline"
            style={{
              gridColumn: "1/-1",
              textAlign: "center",
              padding: 48,
            }}
          >
            All references filtered out. Re-enable a chip above.
          </div>
        ) : (
          filteredRefs.map((ref) => {
            const frame = frameById.get(ref.source_frame_id);
            const paletteHex = frame?.palette_hex ?? [];
            const paletteDescriptors = frame?.palette ?? [];
            const idx = report.references.indexOf(ref);
            return (
              <ReferenceCard
                key={`${ref.source_frame_id}-${idx}`}
                reference={ref}
                paletteHex={paletteHex}
                paletteDescriptors={paletteDescriptors}
                youtubeId={report.youtube_id}
                onJump={() => jumpTo(ref)}
                onFlag={() => handleFlag(idx)}
              />
            );
          })
        )}
      </div>

      <footer className="report-footer">
        <span>Run · {report.youtube_id}</span>
        <span>
          Wikipedia hits · {stats.wikiHits} / {stats.total}
        </span>
        <span>
          References · {stats.confirmed} confirmed · {stats.speculative}{" "}
          speculative · {stats.hidden} hidden
        </span>
      </footer>
    </main>
  );
}
```

- [ ] **Step 2: Simplify `page.tsx` to delegate to ReportContent**

Replace `/home/louis/clip-decoder/frontend/app/report/[id]/page.tsx` with:

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchReport, subscribePipeline } from "@/lib/api";
import type { PipelineEvent, Report } from "@/lib/types";
import { PipelineStatus } from "@/components/PipelineStatus";
import { ReportContent } from "@/components/report/ReportContent";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let close: (() => void) | undefined;

    async function load() {
      const r = await fetchReport(id);
      if (cancelled) return;
      if (r) {
        setReport(r);
        return;
      }
      close = subscribePipeline(
        id,
        async (e) => {
          if (cancelled) return;
          setEvents((prev) => [...prev, e]);
          if (e.step === "done") {
            const fresh = await fetchReport(id);
            if (!cancelled) setReport(fresh);
          }
          if (e.step === "error") setError(e.message);
        },
        (err) => !cancelled && setError(String(err)),
      );
    }
    void load();
    return () => {
      cancelled = true;
      close?.();
    };
  }, [id]);

  if (report) return <ReportContent report={report} youtubeId={id} />;

  if (error) {
    return (
      <main className="frame surface-dark relative min-h-screen flex flex-col">
        <div className="slate">
          <span className="dot" />
          <b>ClipDecoder</b>
          <span className="slate-context">Report</span>
          <span className="sep" />
          <span className="tc">{id}</span>
        </div>
        <div style={{ padding: "clamp(32px, 5vw, 64px)", maxWidth: 720 }}>
          <div className="hairline" style={{ marginBottom: 16, color: "var(--error)" }}>
            Pipeline error
          </div>
          <h1 className="serif-it" style={{ fontSize: "clamp(28px, 4vw, 48px)", color: "var(--ink)" }} role="alert">
            {error}
          </h1>
          <Link className="ulink" href="/" style={{ marginTop: 24, display: "inline-block" }}>
            ← Try another clip
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="frame surface-dark relative min-h-screen flex flex-col">
      <div className="slate">
        <span className="dot" />
        <b>ClipDecoder</b>
        <span className="slate-context">Report</span>
        <span className="sep" />
        <span className="tc">{id}</span>
      </div>
      <div style={{ padding: "clamp(32px, 5vw, 64px)" }}>
        <PipelineStatus events={events} />
      </div>
    </main>
  );
}
```

(At this point the page still uses the SP2-reskinned `PipelineStatus` for loading — that's intentional. Task 10 swaps it for `PipelinePage`.)

- [ ] **Step 3: TypeScript + tests**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: zero errors, 19 tests pass. **The app should behave exactly like end-of-SP2.**

- [ ] **Step 4: Commit**

```bash
git add 'frontend/app/report/[id]/page.tsx' frontend/components/report/ReportContent.tsx
git commit -m "refactor(frontend): extract SP2 report body into ReportContent (no behavior change)"
```

---

### Task 10: Page.tsx switches between PipelinePage and ReportContent (stub PipelinePage)

**Files:**
- Modify: `frontend/app/report/[id]/page.tsx`
- Create: `frontend/components/pipeline/PipelinePage.tsx` (stub for now)

**Why:** Introduce the routing-layer switch. The PipelinePage at this point is just a stub that renders the existing `PipelineStatus` — so behavior is unchanged. Subsequent tasks (11–17) fill in the 9 pipeline components and finally Task 18 assembles them in PipelinePage.

- [ ] **Step 1: Create stub `PipelinePage.tsx`**

Create `/home/louis/clip-decoder/frontend/components/pipeline/PipelinePage.tsx`:

```tsx
"use client";
import Link from "next/link";
import type { PipelineEvent } from "@/lib/types";
import { PipelineStatus } from "@/components/PipelineStatus";

export function PipelinePage({
  youtubeId,
  events,
  error,
}: {
  youtubeId: string;
  events: PipelineEvent[];
  error: string | null;
}) {
  if (error) {
    return (
      <main className="frame surface-dark relative min-h-screen flex flex-col">
        <div className="slate">
          <span className="dot" />
          <b>ClipDecoder</b>
          <span className="slate-context">Report</span>
          <span className="sep" />
          <span className="tc">{youtubeId}</span>
        </div>
        <div style={{ padding: "clamp(32px, 5vw, 64px)", maxWidth: 720 }}>
          <div className="hairline" style={{ marginBottom: 16, color: "var(--error)" }}>
            Pipeline error
          </div>
          <h1 className="serif-it" style={{ fontSize: "clamp(28px, 4vw, 48px)", color: "var(--ink)" }} role="alert">
            {error}
          </h1>
          <Link className="ulink" href="/" style={{ marginTop: 24, display: "inline-block" }}>
            ← Try another clip
          </Link>
        </div>
      </main>
    );
  }

  // Stub: renders SP2 PipelineStatus until Task 18 fills in the full layout.
  return (
    <main className="frame surface-dark relative min-h-screen flex flex-col">
      <div className="slate">
        <span className="dot" />
        <b>ClipDecoder</b>
        <span className="slate-context">Report</span>
        <span className="sep" />
        <span className="tc">{youtubeId}</span>
      </div>
      <div style={{ padding: "clamp(32px, 5vw, 64px)" }}>
        <PipelineStatus events={events} />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Update `page.tsx` to delegate to PipelinePage**

Replace `/home/louis/clip-decoder/frontend/app/report/[id]/page.tsx` with the slim router:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchReport, subscribePipeline } from "@/lib/api";
import type { PipelineEvent, Report } from "@/lib/types";
import { PipelinePage } from "@/components/pipeline/PipelinePage";
import { ReportContent } from "@/components/report/ReportContent";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let close: (() => void) | undefined;

    async function load() {
      const r = await fetchReport(id);
      if (cancelled) return;
      if (r) {
        setReport(r);
        return;
      }
      close = subscribePipeline(
        id,
        async (e) => {
          if (cancelled) return;
          setEvents((prev) => [...prev, e]);
          if (e.step === "done") {
            const fresh = await fetchReport(id);
            if (!cancelled) setReport(fresh);
          }
          if (e.step === "error") setError(e.message);
        },
        (err) => !cancelled && setError(String(err)),
      );
    }
    void load();
    return () => {
      cancelled = true;
      close?.();
    };
  }, [id]);

  if (report) return <ReportContent report={report} youtubeId={id} />;
  return <PipelinePage youtubeId={id} events={events} error={error} />;
}
```

- [ ] **Step 3: TypeScript + tests**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: zero errors, 19 tests pass. App behavior unchanged.

- [ ] **Step 4: Commit**

```bash
git add 'frontend/app/report/[id]/page.tsx' frontend/components/pipeline/PipelinePage.tsx
git commit -m "feat(frontend): slim page.tsx into router + stub PipelinePage"
```

---

### Task 11: Create PipelineSlate + ClipMetadataPane + PipelineFooterSlate (3 small static components)

**Files:**
- Create: `frontend/components/pipeline/PipelineSlate.tsx`
- Create: `frontend/components/pipeline/ClipMetadataPane.tsx`
- Create: `frontend/components/pipeline/PipelineFooterSlate.tsx`

**Why:** Three components with no shared logic but all small, static, and consumed only by `PipelinePage`. Grouping into one task keeps the plan from sprawling.

- [ ] **Step 1: Create `PipelineSlate.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";

function formatElapsed(startTs: number): string {
  const s = Math.floor((Date.now() - startTs) / 1000);
  const hh = Math.floor(s / 3600).toString().padStart(2, "0");
  const mm = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function PipelineSlate({
  youtubeId,
  startTs,
}: {
  youtubeId: string;
  startTs: number | null;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!startTs) return;
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [startTs]);

  return (
    <div className="slate">
      <span className="dot" />
      <b>ClipDecoder</b>
      <span className="slate-context">analysing · do not close tab</span>
      <span className="sep" />
      <span className="tc">clip · {youtubeId}</span>
      <span className="tc">
        elapsed {startTs ? formatElapsed(startTs) : "00:00:00"}
      </span>
      <span className="sep" />
    </div>
  );
}
```

- [ ] **Step 2: Create `ClipMetadataPane.tsx`**

```tsx
"use client";
import type { IngestPayload } from "@/lib/types";

export function ClipMetadataPane({
  meta,
  youtubeId,
}: {
  meta: IngestPayload | null;
  youtubeId: string;
}) {
  function formatDuration(s: number): string {
    const t = Math.floor(s);
    return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
  }

  return (
    <dl className="clip-meta">
      <div>
        <dt>YouTube ID</dt>
        <dd className="mono">{youtubeId}</dd>
      </div>
      <div>
        <dt>Title</dt>
        <dd className="serif">{meta?.title ?? "—"}</dd>
      </div>
      <div>
        <dt>Channel · Duration</dt>
        <dd>
          {meta
            ? `${meta.channel} · ${formatDuration(meta.duration_s)}`
            : "— · —"}
        </dd>
      </div>
      <div>
        <dt>Captions</dt>
        <dd>
          {meta && meta.captions_count > 0
            ? `auto · en (${meta.captions_count} cues)`
            : "none"}
        </dd>
      </div>
    </dl>
  );
}
```

- [ ] **Step 3: Create `PipelineFooterSlate.tsx`**

```tsx
"use client";

export function PipelineFooterSlate() {
  return (
    <div className="pipeline-footer-slate">
      <span>NIM concurrency 4</span>
      <span className="sep" />
      <span>Wikipedia verification on</span>
      <span className="sep" />
      <span>Max shots / video 80</span>
    </div>
  );
}
```

(Static placeholder values — `settings` exposure is Tier 5.)

- [ ] **Step 4: TypeScript + tests**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: zero errors, 19 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/pipeline/PipelineSlate.tsx frontend/components/pipeline/ClipMetadataPane.tsx frontend/components/pipeline/PipelineFooterSlate.tsx
git commit -m "feat(frontend): add PipelineSlate, ClipMetadataPane, PipelineFooterSlate"
```

---

### Task 12: Create PipelineList component

**Files:**
- Create: `frontend/components/pipeline/PipelineList.tsx`

**Why:** 5-row pipeline progress display. Consumes pre-classified `StepInfo[]` from `pipelineStats.classifySteps()`. Pure presentational.

- [ ] **Step 1: Create the component**

Create `/home/louis/clip-decoder/frontend/components/pipeline/PipelineList.tsx`:

```tsx
"use client";
import type { PipelineEvent } from "@/lib/types";
import { classifySteps } from "@/lib/pipelineStats";

export function PipelineList({ events }: { events: PipelineEvent[] }) {
  const steps = classifySteps(events);
  return (
    <div className="pipeline-list">
      {steps.map((s, i) => (
        <div
          key={s.key}
          className={`pipeline-row ${s.status === "done" ? "done" : ""} ${s.status === "active" ? "active" : ""} ${s.status === "error" ? "error" : ""}`}
        >
          <span className="pill">
            <span className="num">{String(i + 1).padStart(2, "0")}</span>
            <em>{s.label}</em>
          </span>
          <span className="progress">
            <i style={{ width: `${s.progress * 100}%` }} />
          </span>
          <span className="frac">{s.fraction}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript + tests**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: zero errors, 19 tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/pipeline/PipelineList.tsx
git commit -m "feat(frontend): add PipelineList component (5-row progress display)"
```

---

### Task 13: Create NowFrame component

**Files:**
- Create: `frontend/components/pipeline/NowFrame.tsx`

**Why:** The "current frame being analyzed" centerpiece. Shows the frame image with vignette + scan + crosshair overlays + label + meta overlay + palette swatches.

- [ ] **Step 1: Create the component**

Create `/home/louis/clip-decoder/frontend/components/pipeline/NowFrame.tsx`:

```tsx
"use client";
import type { VisionFramePayload } from "@/lib/types";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  const minutes = Math.floor(t / 60);
  const seconds = t % 60;
  const ms = Math.floor((s - t) * 1000);
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

export function NowFrame({
  frame,
  youtubeId,
}: {
  frame: VisionFramePayload | null;
  youtubeId: string;
}) {
  if (!frame) {
    return (
      <div className="now vignette">
        <div className="label">VISION · AWAITING FIRST FRAME</div>
      </div>
    );
  }
  return (
    <div>
      <div className="now vignette">
        <img
          src={`/api/frames/${youtubeId}/${frame.frame_id}`}
          alt=""
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div className="scan" />
        <div className="crosshair">
          <svg width="48" height="48" viewBox="0 0 48 48">
            <line x1="0" y1="24" x2="48" y2="24" stroke="white" strokeWidth="0.5" />
            <line x1="24" y1="0" x2="24" y2="48" stroke="white" strokeWidth="0.5" />
            <circle cx="24" cy="24" r="12" stroke="white" strokeWidth="0.5" fill="none" />
          </svg>
        </div>
        <div className="label">
          VISION · FRAME {frame.shot_index.toString().padStart(3, "0")} / {frame.total_shots.toString().padStart(3, "0")}
        </div>
        <div className="meta-overlay">
          <span>{formatTimecode(frame.timestamp_s)}</span>
          <span>
            {frame.frame_id.toUpperCase()}
            {frame.composition ? ` · ${frame.composition.toUpperCase()}` : ""}
          </span>
        </div>
      </div>
      {frame.palette_hex && frame.palette_hex.length > 0 && (
        <div className="now-palette">
          {frame.palette_hex.map((hex, i) => (
            <span key={i} style={{ background: hex }} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript + tests**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: zero errors, 19 tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/pipeline/NowFrame.tsx
git commit -m "feat(frontend): add NowFrame component (current frame with vignette + scan + meta)"
```

---

### Task 14: Create KeyframeStrip component + 2 TDD tests

**Files:**
- Create: `frontend/components/pipeline/KeyframeStrip.tsx`
- Create: `frontend/components/pipeline/KeyframeStrip.test.tsx`

**Why:** Horizontal scroll strip with pending → analyzed → latest states. Tested behavior — pending count + analyzed state transitions are derivable + worth pinning.

- [ ] **Step 1: Write the 2 failing tests**

Create `/home/louis/clip-decoder/frontend/components/pipeline/KeyframeStrip.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { KeyframeStrip } from "./KeyframeStrip";

describe("KeyframeStrip", () => {
  it("renders N pending cells from keyframes list", () => {
    const keyframes = [
      { shot_id: "shot_00", timestamp_s: 8 },
      { shot_id: "shot_01", timestamp_s: 21 },
      { shot_id: "shot_02", timestamp_s: 42 },
    ];
    render(
      <KeyframeStrip
        keyframes={keyframes}
        analyzedIds={new Set()}
        latestId={null}
        youtubeId="x"
      />,
    );
    const cells = screen.getAllByTestId("kf-cell");
    expect(cells).toHaveLength(3);
    for (const cell of cells) {
      expect(cell.className).toContain("pending");
    }
  });

  it("marks analyzed cells when their shot_id is in analyzedIds", () => {
    const keyframes = [
      { shot_id: "shot_00", timestamp_s: 8 },
      { shot_id: "shot_01", timestamp_s: 21 },
    ];
    render(
      <KeyframeStrip
        keyframes={keyframes}
        analyzedIds={new Set(["shot_00"])}
        latestId="shot_00"
        youtubeId="x"
      />,
    );
    const cells = screen.getAllByTestId("kf-cell");
    expect(cells[0].className).not.toContain("pending");
    expect(cells[0].className).toContain("latest");
    expect(cells[1].className).toContain("pending");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run components/pipeline/KeyframeStrip
```
Expected: fail with module resolution error.

- [ ] **Step 3: Create the component**

Create `/home/louis/clip-decoder/frontend/components/pipeline/KeyframeStrip.tsx`:

```tsx
"use client";
import { useEffect, useRef } from "react";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
}

export function KeyframeStrip({
  keyframes,
  analyzedIds,
  latestId,
  youtubeId,
}: {
  keyframes: { shot_id: string; timestamp_s: number }[];
  analyzedIds: Set<string>;
  latestId: string | null;
  youtubeId: string;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const latestCellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (latestId && latestCellRef.current) {
      latestCellRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [latestId]);

  const analyzedCount = analyzedIds.size;
  const pendingCount = keyframes.length - analyzedCount;

  return (
    <div className="strip-row">
      <div className="lbl">
        <span>EXTRACTED KEYFRAMES</span>
        <span>
          {analyzedCount} analysed · {pendingCount} pending
        </span>
      </div>
      <div className="strip" ref={stripRef}>
        {keyframes.map((kf) => {
          const isAnalyzed = analyzedIds.has(kf.shot_id);
          const isLatest = kf.shot_id === latestId;
          return (
            <div
              key={kf.shot_id}
              ref={isLatest ? latestCellRef : null}
              data-testid="kf-cell"
              className={`cell ${isAnalyzed ? "analyzed" : "pending"} ${isLatest ? "latest" : ""}`}
            >
              {isAnalyzed && (
                <img
                  src={`/api/frames/${youtubeId}/${kf.shot_id}`}
                  alt=""
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <span className="tc">{formatTimecode(kf.timestamp_s)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests + full suite**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run components/pipeline/KeyframeStrip
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: 2 new tests pass, 21 total (19 + 2).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/pipeline/KeyframeStrip.tsx frontend/components/pipeline/KeyframeStrip.test.tsx
git commit -m "feat(frontend): add KeyframeStrip with pending/analyzed/latest cells + 2 TDD tests"
```

---

### Task 15: Create LogPane component

**Files:**
- Create: `frontend/components/pipeline/LogPane.tsx`

**Why:** Live log with auto-scroll. Pure presentational — receives pre-built lines.

- [ ] **Step 1: Create the component**

Create `/home/louis/clip-decoder/frontend/components/pipeline/LogPane.tsx`:

```tsx
"use client";
import { useEffect, useRef } from "react";
import type { PipelineEvent } from "@/lib/types";

interface LogLine {
  t: string;
  lvl: string;
  text?: string;
  quote?: string;
  flag?: string;
  isError?: boolean;
  isCandidate?: boolean;
}

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}
function pad3(n: number) {
  return n.toString().padStart(3, "0");
}

function formatT(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
}

export function buildLogLines(events: PipelineEvent[]): LogLine[] {
  const startTs = Date.now() - events.length * 50; // approximate; client-side
  const lines: LogLine[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const t = formatT(startTs + i * 50);
    if (e.step === "ingest") {
      const p = e.payload as { title?: string; duration_s?: number };
      lines.push({
        t,
        lvl: "ingest",
        text: "→ ok",
        quote: p.title ? `"${p.title} · ${p.duration_s ?? "?"}s"` : undefined,
      });
    } else if (e.step === "shots") {
      const p = e.payload as { shot_count?: number };
      lines.push({
        t,
        lvl: "shots",
        text: `→ ${p.shot_count ?? 0} boundaries · keyframes capped at 80`,
      });
    } else if (e.step === "vision_frame") {
      const p = e.payload as { frame_id: string; raw_description: string };
      lines.push({
        t,
        lvl: "vision",
        text: p.frame_id,
        quote: `"${p.raw_description.slice(0, 70)}${p.raw_description.length > 70 ? "…" : ""}"`,
      });
    } else if (e.step === "crossref_candidate") {
      const p = e.payload as { work_title: string; work_creator: string };
      lines.push({
        t,
        lvl: "candidate",
        text: `→ ${p.work_title} / ${p.work_creator}`,
        isCandidate: true,
      });
    } else if (e.step === "error") {
      lines.push({ t, lvl: "error", text: e.message, isError: true });
    }
  }
  return lines.slice(-30); // cap rendered lines
}

export function LogPane({ events }: { events: PipelineEvent[] }) {
  const logRef = useRef<HTMLDivElement>(null);
  const lines = buildLogLines(events);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div className="log-pane">
      <h3>
        <span className="live">Live log — NIM stream</span>
        <span>tail · auto-scroll</span>
      </h3>
      <div className="log" ref={logRef}>
        {lines.length === 0 ? (
          <div>
            <span className="lvl">log</span>
            <span className="v">Awaiting first event…</span>
          </div>
        ) : (
          lines.map((line, i) => (
            <div key={i}>
              <span className="t">{line.t}</span>
              <span
                className={`lvl ${line.isCandidate ? "candidate" : ""} ${line.isError ? "error" : ""}`}
              >
                {line.lvl}
              </span>
              {line.text && <span className="v">{line.text}</span>}
              {line.quote && <span className="q">{line.quote}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript + tests**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: zero errors, 21 tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/pipeline/LogPane.tsx
git commit -m "feat(frontend): add LogPane with auto-scroll + buildLogLines from events"
```

---

### Task 16: Create CandidatesPane component

**Files:**
- Create: `frontend/components/pipeline/CandidatesPane.tsx`

**Why:** Right column. Builds cite-cards from `crossref_candidate` events with staggered fade-in. Includes "You can close this tab" footer.

- [ ] **Step 1: Create the component**

Create `/home/louis/clip-decoder/frontend/components/pipeline/CandidatesPane.tsx`:

```tsx
"use client";
import type { CrossrefCandidatePayload, PipelineEvent } from "@/lib/types";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
}

export function CandidatesPane({ events }: { events: PipelineEvent[] }) {
  const candidates: CrossrefCandidatePayload[] = events
    .filter((e) => e.step === "crossref_candidate")
    .map((e) => e.payload as CrossrefCandidatePayload);

  return (
    <>
      <div
        className="hairline"
        style={{ marginTop: 8, marginBottom: 12 }}
      >
        Early signal — candidates surfacing
      </div>
      <div className="candidates-pane">
        {candidates.length === 0 ? (
          <div className="candidates-empty">No candidates yet…</div>
        ) : (
          candidates.map((c, i) => (
            <div
              key={`${c.timestamp_s}-${c.work_title}-${i}`}
              className={`candidate-card ${c.raw_confidence < 0.5 ? "weak" : ""}`}
              style={{ animationDelay: `${Math.min(i * 80, 800)}ms` }}
            >
              <div
                className="hairline"
                style={{
                  color: c.raw_confidence < 0.5 ? "var(--grad-sky)" : "var(--grad-peach)",
                }}
              >
                {formatTimecode(c.timestamp_s)} ·{" "}
                {c.raw_confidence < 0.5 ? "weak signal" : "candidate"}
              </div>
              <div
                className="serif-it"
                style={{ fontSize: 19, marginTop: 4, color: "var(--ink)" }}
              >
                {c.work_title}
              </div>
              <div className="hairline" style={{ marginTop: 4 }}>
                {c.work_creator}
                {c.work_year ? `, ${c.work_year}` : ""}
              </div>
              <div
                className="hairline"
                style={{ marginTop: 10, color: "var(--muted-soft)", fontSize: 12 }}
              >
                awaiting verify ◌
              </div>
            </div>
          ))
        )}

        <div className="candidates-footer">
          <div className="hairline">You can close this tab</div>
          <div className="candidates-footer-body">
            Analysis runs server-side. Bookmark the report URL — it&apos;ll fill in
            as the pipeline finishes.
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: TypeScript + tests**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: zero errors, 21 tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/pipeline/CandidatesPane.tsx
git commit -m "feat(frontend): add CandidatesPane with staggered fade-in cards + close-tab footer"
```

---

### Task 17: Assemble PipelinePage with all 9 sub-components

**Files:**
- Modify: `frontend/components/pipeline/PipelinePage.tsx`

**Why:** Replace the stub with the full 3-column composition.

- [ ] **Step 1: Replace `PipelinePage.tsx` entirely**

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  IngestPayload,
  PipelineEvent,
  ShotsPayload,
  VisionFramePayload,
} from "@/lib/types";
import { PipelineSlate } from "./PipelineSlate";
import { ClipMetadataPane } from "./ClipMetadataPane";
import { PipelineList } from "./PipelineList";
import { NowFrame } from "./NowFrame";
import { KeyframeStrip } from "./KeyframeStrip";
import { LogPane } from "./LogPane";
import { CandidatesPane } from "./CandidatesPane";
import { PipelineFooterSlate } from "./PipelineFooterSlate";

export function PipelinePage({
  youtubeId,
  events,
  error,
}: {
  youtubeId: string;
  events: PipelineEvent[];
  error: string | null;
}) {
  // Capture the timestamp of the first event for elapsed counter.
  const [startTs, setStartTs] = useState<number | null>(null);
  useEffect(() => {
    if (events.length > 0 && startTs === null) {
      setStartTs(Date.now());
    }
  }, [events.length, startTs]);

  const clipMeta = useMemo<IngestPayload | null>(() => {
    const ingest = events.find((e) => e.step === "ingest");
    return ingest ? (ingest.payload as IngestPayload) : null;
  }, [events]);

  const keyframes = useMemo(() => {
    const shots = events.find((e) => e.step === "shots");
    return shots ? (shots.payload as ShotsPayload).keyframes : [];
  }, [events]);

  const visionFrames = useMemo(
    () =>
      events
        .filter((e) => e.step === "vision_frame")
        .map((e) => e.payload as VisionFramePayload),
    [events],
  );

  const lastVisionFrame = visionFrames[visionFrames.length - 1] ?? null;
  const analyzedIds = useMemo(
    () => new Set(visionFrames.map((p) => p.frame_id)),
    [visionFrames],
  );

  if (error) {
    return (
      <main className="frame surface-dark relative min-h-screen flex flex-col">
        <PipelineSlate youtubeId={youtubeId} startTs={startTs} />
        <div style={{ padding: "clamp(32px, 5vw, 64px)", maxWidth: 720 }}>
          <div className="hairline" style={{ marginBottom: 16, color: "var(--error)" }}>
            Pipeline error
          </div>
          <h1
            className="serif-it"
            style={{ fontSize: "clamp(28px, 4vw, 48px)", color: "var(--ink)" }}
            role="alert"
          >
            {error}
          </h1>
          <Link
            className="ulink"
            href="/"
            style={{ marginTop: 24, display: "inline-block" }}
          >
            ← Try another clip
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="frame surface-dark relative min-h-screen flex flex-col">
      <PipelineSlate youtubeId={youtubeId} startTs={startTs} />

      <div className="pipeline-stage">
        <div className="pipeline-col-left">
          <h2 className="pipeline-h2 serif-it">
            <em>Reading</em>
            <br />
            the tape.
          </h2>
          <ClipMetadataPane meta={clipMeta} youtubeId={youtubeId} />
          <PipelineList events={events} />
        </div>

        <div className="pipeline-col-center">
          <NowFrame frame={lastVisionFrame} youtubeId={youtubeId} />
          <KeyframeStrip
            keyframes={keyframes}
            analyzedIds={analyzedIds}
            latestId={lastVisionFrame?.frame_id ?? null}
            youtubeId={youtubeId}
          />
          <LogPane events={events} />
        </div>

        <div className="pipeline-col-right">
          <CandidatesPane events={events} />
        </div>
      </div>

      <PipelineFooterSlate />
    </main>
  );
}
```

- [ ] **Step 2: TypeScript + tests**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: zero errors, 21 tests pass.

- [ ] **Step 3: Smoke check the dev server**

If port 3000 is reachable from your browser (i.e. no port conflict), visit `http://localhost:3000/report/anything` — should render the new 3-column PipelinePage in error state ("Try another clip" link, since "anything" isn't a real ID). If port is not reachable, do a `curl` to verify HTTP 200:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/report/anything
```
Expected: 200.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/pipeline/PipelinePage.tsx
git commit -m "feat(frontend): assemble PipelinePage with 9 sub-components"
```

---

### Task 18: Delete obsolete PipelineStatus + its test

**Files:**
- Delete: `frontend/components/PipelineStatus.tsx`
- Delete: `frontend/components/PipelineStatus.test.tsx`

**Why:** Replaced by `PipelinePage` + `PipelineList`. No remaining consumers — the slim router in `page.tsx` imports from `@/components/pipeline/PipelinePage` (Task 10).

- [ ] **Step 1: Verify zero remaining consumers**

```bash
cd /home/louis/clip-decoder/frontend && grep -rn "PipelineStatus" app components --include='*.tsx' --include='*.ts'
```
Expected: only hits inside `components/PipelineStatus.tsx` and `components/PipelineStatus.test.tsx`.

If any other file references `PipelineStatus`: STOP. Update that file to import from `@/components/pipeline/PipelinePage` instead, or escalate.

- [ ] **Step 2: Delete the files**

```bash
rm /home/louis/clip-decoder/frontend/components/PipelineStatus.tsx
rm /home/louis/clip-decoder/frontend/components/PipelineStatus.test.tsx
```

- [ ] **Step 3: TypeScript + tests**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: zero errors. Test count drops by 2 (`PipelineStatus.test.tsx` had 2 tests in SP2). 21 - 2 = 19? wait, no — earlier we said 21 includes the 3 PipelineStats + 2 KeyframeStrip new tests on top of pre-SP3 16. Removing PipelineStatus removes its 2 tests → 21 - 2 = 19 expected.

Actually let me recount: SP2 baseline 16 tests. SP3 adds 3 (pipelineStats) + 2 (KeyframeStrip) = +5 = 21. Remove PipelineStatus 2 tests = -2 = **19 expected after Task 18**.

- [ ] **Step 4: Commit**

```bash
git rm frontend/components/PipelineStatus.tsx frontend/components/PipelineStatus.test.tsx
git commit -m "chore(frontend): delete obsolete PipelineStatus (replaced by PipelinePage)"
```

---

### Task 19: Final grep audit + manual verification

**Files:**
- No modifications expected. Verification only.

**Why:** Catch any stale legacy refs, run full backend + frontend suites, walk through the manual checklist on a real video (if possible).

- [ ] **Step 1: Grep audit**

```bash
cd /home/louis/clip-decoder/frontend && \
  grep -rn 'PipelineStatus\|tracking-mono-label\|tracking-display\|tracking-body\|font-display\|font-mono\|bg-deep-sky\|text-aurora\|glass-dark\|wordmark-foot\|bg-dawn-cloud\|btn-midnight\|fill-aurora\|step-glow\|float-slow\|caret\b\|shadow-aurora\|tracking-h2\|tracking-h3\|rounded-comfy\|rounded-sharp' \
  app components --include='*.tsx' --include='*.ts'
```

Expected: zero hits. If hits appear: list them, fix, commit cleanup.

- [ ] **Step 2: Full backend suite**

```bash
docker exec clip-decoder-backend-1 python -m pytest -q --ignore=tests/integration/test_e2e.py
```
Expected: 64 passing (was 59 baseline + 5 new SP3 tests).

- [ ] **Step 3: Full frontend suite + tsc**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
```
Expected: 19 tests pass, zero TS errors.

- [ ] **Step 4: Smoke verification via curl**

```bash
curl -s -o /dev/null -w "Report: %{http_code}\n" http://localhost:3000/report/anything
curl -s http://localhost:3000/report/anything | grep -c "ClipDecoder\|Reading the tape\|EXTRACTED KEYFRAMES\|Early signal" 2>/dev/null
```

(If port 3000 is unreachable due to local conflict, this step is best-effort — note in the report.)

Expected: HTTP 200, grep finds at least 3 phrases (Reading the tape may not be in error state; ClipDecoder always is).

- [ ] **Step 5: Visual checklist (browser, if available)**

If you can reach `http://localhost:3000` in a browser:

1. Submit a real YouTube URL on the landing → redirect to `/report/{id}` → PipelinePage 3-column layout renders within 1s.
2. Slate top: dot, "ClipDecoder · analysing · do not close tab · clip · {id} · elapsed mm:ss" — elapsed ticks every second.
3. Left col: serif "Reading the tape." h2. ClipMetadataPane fills in (title, channel, duration, captions count = 0).
4. PipelineList shows 5 rows progressing: Ingest done → Shots N/N done → Vision active with X/N count → Cross-ref pending → Verify pending.
5. Center col: NowFrame transitions from placeholder to first frame. Scan line animates. Palette swatches visible.
6. KeyframeStrip starts with all pending cells (just timecodes), thumbs appear progressively.
7. LogPane scrolls with each new event.
8. Right col: "No candidates yet…" → cards appear (staggered fade-in) when crossref starts streaming.
9. Footer slate: "NIM concurrency 4 · Wikipedia verification on · Max shots / video 80".
10. When `done` arrives → page swaps to ReportContent (no flash).
11. Reload mid-pipeline → state replays consistently.
12. Reload after done → ReportContent loads directly.
13. Mobile (≤900px) → 3 cols collapse to 1.
14. Reduced motion → scan animation static, fade-in disabled.

If any check fails, note specifically what's wrong and either fix in place or escalate.

- [ ] **Step 6: If any cleanup commit was needed**

```bash
git add <changed files>
git commit -m "chore(frontend): final SP3 cleanup"
```

- [ ] **Step 7: Push the branch (controller decision — don't push from subagent)**

The controller / human will review and decide when to merge `feature/design-system-sp3` into `main`.

---

## Self-review

**Spec coverage:**
- Backend `ingest` payload extension → Task 3
- Backend `shots` payload extension → Task 3
- Backend `vision_frame` event → Task 3 (uses callback from Task 1)
- Backend `crossref_candidate` event → Task 3 (uses callback from Task 2)
- `frame_analyzer.analyze(on_frame=)` → Task 1
- `ref_proposer.propose(on_candidate=)` → Task 2
- EventBus adaptive pace → Task 4
- Frontend types + payloads → Task 5
- SSE dedup in `lib/api.ts` (REQUIRED per spec) → Task 6
- `lib/pipelineStats.ts` helper + 3 tests → Task 7
- SP3 CSS block → Task 8
- ReportContent atomic refactor → Task 9
- Page.tsx slim router → Task 10
- PipelineSlate + ClipMetadataPane + PipelineFooterSlate → Task 11
- PipelineList → Task 12
- NowFrame → Task 13
- KeyframeStrip + 2 tests → Task 14
- LogPane → Task 15
- CandidatesPane → Task 16
- PipelinePage assembly → Task 17
- Delete PipelineStatus → Task 18
- Final audit → Task 19

**Placeholder scan:** No "TBD", no "implement later", every code step has actual code, every command has expected output.

**Type consistency:**
- `PipelineStep` union includes `vision_frame` + `crossref_candidate` in Task 5 → consumed in Tasks 6, 7, 13, 14, 15, 16, 17.
- `IngestPayload`, `ShotsPayload`, `VisionFramePayload`, `CrossrefCandidatePayload` defined in Task 5 → consumed in Tasks 11, 13, 14, 16, 17.
- `StepInfo` from Task 7 → consumed in Task 12.
- `on_frame` callback signature `Callable[[FrameAnalysis, int, int], Awaitable[None]]` defined in Task 1 → consumed in Task 3.
- `on_candidate` callback signature `Callable[[ReferenceCandidate], Awaitable[None]]` defined in Task 2 → consumed in Task 3.
- `PipelinePage` props `{ youtubeId, events, error }` from Task 10 → consumed in Task 17 (same signature).
- `KeyframeStrip` props `{ keyframes, analyzedIds, latestId, youtubeId }` from Task 14 → consumed in Task 17.
- `NowFrame` props `{ frame, youtubeId }` from Task 13 → consumed in Task 17.

All types and signatures match across tasks.
