# Design System Migration — Sub-project 3: Pipeline live page

> Third sub-project of the 5-sub-project design refactor (`index.html` + `styles.css` at repo root). SP1 (landing) and SP2 (report enriched) are merged. SP3 builds a dedicated "pipeline running" experience that takes over the loading state of `/report/{id}` while the analysis is in progress.

## Goal

Replace the minimal `PipelineStatus` loading state (SP2 reskinned) with a full editorial **3-column live view**:

- **Left**: clip metadata + pipeline progress (5 rows with per-step progress bars)
- **Center**: current frame being analyzed (with vignette/scan/crosshair overlays) + horizontal strip of keyframes (pending → analyzed cells) + live NIM log pane
- **Right**: candidates surfacing in real time as the cross-ref pass proposes them

The page lives at the **same `/report/{id}` route** as the final report. Internal component switch: `PipelinePage` while the report is loading, `ReportContent` once `fetchReport` returns a non-null Report.

To make the live view meaningful, the backend SSE stream is enriched with two new event types (`vision_frame`, `crossref_candidate`) plus payload additions on existing `ingest` and `shots` events. The visual reskin alone would be hollow without these — most of the page would be placeholder content during the 2-5 minute vision pass.

## Non-goals

- **Cancel button** (DELETE endpoint + asyncio task cancellation) → SP-polish.
- **Estimated remaining time** (timing model + smoothed estimate) → SP-polish.
- **NIM credits tracking** ("142/1000 credits used") — no infrastructure → SP-polish.
- **Per-shot extraction events** (`shot_sampler` is sync — keyframes appear all at once when the `shots` event fires; acceptable given the strip cells start in `pending` state with timecodes only) → out of scope.
- **Verify pass per-ref events** — verify is fast enough batched → out of scope.
- **Reference detail page** → SP4.
- **Error page polish + cookies retry** → SP5.

## Decisions matrix

| Decision | Choice | Rationale |
|---|---|---|
| Route layout | C: same `/report/{id}` route, internal switch between `PipelinePage` and `ReportContent` components | A (single component with loading state) is confusing; B (separate `/pipeline/{id}` route with redirect) is overkill for one-dev project. C keeps URL stable, code clean. |
| Feature scope | D: visual reskin + per-frame events + per-candidate events + clip metadata in ingest event | Tier 1 alone (visual only) leaves the page hollow during pipeline. Tier 4 (metadata in ingest event) is 4 lines of code and avoids "loading…" placeholders in the left column. |
| Keyframe strip behavior | A: enrich `shots` event payload with full `keyframes` list, frontend renders pending → analyzed | Strip with pending cells gives the user a sense of progress ("how many frames left"). C (uniform distribution estimation) is misleading; B (analyzed-only) loses the strip's value. |
| Cancel / remaining / credits | Deferred (Tier 5) | Real backend features, not visual decisions; each deserves its own sub-project. |

## Architecture

### Backend changes (additions only, no breaking changes)

#### `backend/app/pipeline/orchestrator.py` (modify)

Enrich existing events + emit new ones via callbacks:

```python
# Inside run():
# After ingestor returns:
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

# After sampler returns:
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

# Vision pass with per-frame callback:
async def _on_vision_frame(fa: FrameAnalysis, index: int, total: int) -> None:
    msg = fa.raw_description[:80] + ("…" if len(fa.raw_description) > 80 else "")
    await self._emit(
        yid, "vision_frame",
        message=msg,
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
await self._emit(yid, "vision", f"Analyzed {len(frame_analyses)} frames", 0.55)

# Crossref with per-candidate callback:
async def _on_candidate(c: ReferenceCandidate) -> None:
    await self._emit(
        yid, "crossref_candidate",
        message=f"{c.work_title} / {c.work_creator}",
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
candidates = await self._ref_proposer.propose(
    title=ingest.title,
    channel=ingest.channel,
    lyrics_text=lyrics,
    frame_analyses=frame_analyses,
    on_candidate=_on_candidate,
)
await self._emit(
    yid, "crossref", f"Proposed {len(candidates)} candidates", 0.7,
)
# ... rest unchanged ...
```

Tests (`backend/tests/unit/test_orchestrator.py`, extend):
1. `test_ingest_event_includes_clip_metadata` — assert payload has title/channel/duration_s/captions_count
2. `test_shots_event_includes_keyframes_list` — assert payload.keyframes has N entries with shot_id + timestamp_s
3. `test_vision_frame_events_emitted_per_frame` — N analyses → N `vision_frame` events with correct shot_index/total

#### `backend/app/pipeline/frame_analyzer.py` (modify)

Add optional `on_frame` parameter to `analyze()`:

```python
async def analyze(
    self,
    keyframes: Iterable[KeyFrame],
    on_frame: Callable[[FrameAnalysis, int, int], Awaitable[None]] | None = None,
) -> list[FrameAnalysis]:
    kfs = list(keyframes)
    results: list[FrameAnalysis] = [None] * len(kfs)
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

`on_progress` existant gardé pour compat backward.

Test (`backend/tests/unit/test_frame_analyzer.py`, extend):
- `test_on_frame_callback_called_for_each_frame` — pass mock callback, assert called N times with FrameAnalysis instance + correct (index, total) args.

#### `backend/app/pipeline/ref_proposer.py` (modify)

Add optional `on_candidate` parameter to `propose()`. Callback fires for each merged candidate after pass1+pass2 dedup:

```python
async def propose(
    self,
    title: str,
    channel: str,
    lyrics_text: str,
    frame_analyses: list[FrameAnalysis],
    on_candidate: Callable[[ReferenceCandidate], Awaitable[None]] | None = None,
) -> list[ReferenceCandidate]:
    # ... existing 2-pass logic, _merge, etc. ...
    merged: list[ReferenceCandidate] = self._merge(pass1, pass2)
    if on_candidate:
        for c in merged:
            await on_candidate(c)
    return merged
```

Test (`backend/tests/unit/test_ref_proposer.py`, extend):
- `test_on_candidate_callback_called_for_each_merged_candidate` — pass mock, assert called N times with each merged candidate.

#### EventBus (`backend/app/api/sse.py`) — no code change, but verify replay performance

The bus stores all events in `_history[youtube_id]` and replays with `_REPLAY_PACE_S = 0.18s` per event to a late subscriber.

With SP3, total history per run grows from ~8 events to ~100 (80 `vision_frame` + 10 `crossref_candidate` + ~10 transition events). At 0.18s × 100 = 18s replay — too slow for reload-mid-pipeline UX.

**Mitigation (deferred to Task 1 / implementation)**: tune `_REPLAY_PACE_S` adaptively — fast pace (10ms) for bursty events (`vision_frame`, `crossref_candidate`), keep 0.18s only for transition events. Or: reduce the universal pace to 0.04s (40ms × 100 = 4s, acceptable). Implementer decides based on a quick visual test during Task 1.

### Frontend changes

#### `frontend/lib/types.ts` (modify)

Extend `PipelineStep` union and add typed payloads:

```ts
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

// PipelineEvent stays loosely typed (payload: Record<string, unknown>) at the
// transport layer. Consumers narrow via `event.step` checks before reading.
```

#### `frontend/app/report/[id]/page.tsx` (rewrite — slim router)

Reduced to ~40 lines: load attempt + SSE subscribe + render either `PipelinePage` or `ReportContent`. Full code in the implementation plan.

#### `frontend/components/report/ReportContent.tsx` (NEW — extract)

Extract the current `app/report/[id]/page.tsx` body (Slate + Header + PlayerRow + FilterBar + Grid + Footer) into a standalone component with prop `{ report: Report; youtubeId: string }`. No behavior change — pure refactor.

#### `frontend/components/pipeline/` (NEW directory, 8 components)

1. **`PipelinePage.tsx`** — top-level. Container holding the slate, the 3-column stage, and the footer slate. Reads `events: PipelineEvent[]`, derives all state via `useMemo`, passes typed slices to children.

2. **`PipelineSlate.tsx`** — top bar: `[dot] ClipDecoder analysing · do not close tab — clip · {id} elapsed {hh:mm:ss}`. No Cancel link (Tier 5 deferred).

3. **`ClipMetadataPane.tsx`** — left col upper. dl of YouTube ID (mono) / Title (serif) / Channel · Duration / Captions count. Empty-state if `clipMeta === null` (ingest event not yet received).

4. **`PipelineList.tsx`** — left col lower. 5 rows with `.pipeline-row .pill .num em .progress .frac` classes from `styles.css`. Step state classified via `classifySteps(events)` helper.

5. **`NowFrame.tsx`** — center upper. Large frame image (background-image from `/api/frames/{yt}/{frame_id}`) + vignette + animated scan line + crosshair SVG + label "VISION · FRAME N / TOTAL" + meta-overlay (timestamp · shot_id · composition). 5 palette swatches below the frame.

6. **`KeyframeStrip.tsx`** — center middle. Horizontal scroll strip of N cells. Each cell: thumb (if analyzed) or empty bg with timecode (if pending). Latest analyzed cell gets a peach border. Auto-scrolls to the latest on `latestId` change.

7. **`LogPane.tsx`** — center lower. Auto-scrolling log of timestamped lines built from events (`ingest`, `shots`, `vision_frame`, `crossref_candidate`, `error`). 8-12 lines visible, max-height with `overflow-y: auto`.

8. **`CandidatesPane.tsx`** — right col. Stack of candidate cite-cards built from `crossref_candidate` events. Staggered fade-in animation. Footer "You can close this tab. Analysis runs server-side." block.

9. **`PipelineFooterSlate.tsx`** — bottom. Static: "NIM concurrency 4 · Wikipedia verification on · Max shots / video 80". (Real values would require a config endpoint — deferred.)

#### `frontend/lib/pipelineStats.ts` (NEW — helper)

Pure function `classifySteps(events: PipelineEvent[]): StepStatus[]` returning the 5-step status array (pending/active/done/error + fraction string + progress 0..1).

Used by `PipelineList.tsx`. Also exposed via `useMemo` in `PipelinePage.tsx`.

#### `frontend/components/PipelineStatus.tsx` (DELETE + `.test.tsx`)

Replaced by `PipelinePage` + `PipelineList`. Logic of the existing `classify()` moves into `lib/pipelineStats.ts`.

#### `frontend/app/globals.css` (additive — append SP3 block)

New CSS classes for pipeline-live components (~150 lines):
- `.pipeline-stage` — 3-col grid `350px 1fr 320px`, gap 24px, padding `0 clamp(32px, 5vw, 64px) 32px`. `@media (max-width: 900px) { grid-template-columns: 1fr; }`
- `.pipeline-col-left`, `.pipeline-col-center`, `.pipeline-col-right` — flex column, gap 16px
- `.pipeline-h2` — clamp(40px, 5vw, 72px) serif-it
- `.clip-meta dl/dt/dd` — uppercase muted dt + body dd
- `.pipeline-row .pill .num em .progress .progress i .frac` — extracted from `styles.css` (lines 213–258)
- `.now` — relative wrapper, aspect-ratio 16/9, border-radius var(--r-2), overflow hidden
- `.now img` — full cover
- `.now .vignette` — box-shadow inset 0 0 80px rgba(0,0,0,0.7)
- `.now .scan` — absolute horizontal 1px line, animation `scan-down 3s linear infinite`
- `@keyframes scan-down { from { top: 0% } to { top: 100% } }`
- `.now .crosshair` — SVG center, opacity 0.3
- `.now .label` / `.now .meta-overlay` — absolute corners, hairline style
- `.strip-row .lbl` / `.strip` / `.cell` / `.cell.analyzed` / `.cell.pending` / `.cell.latest` — keyframe strip
- `.log-pane` — surface-card, border hairline, padding, max-height 200px, overflow-y auto, font-family sans, font-size 12px
- `.log-pane .log div` — flex row, gap 8px
- `.log-pane .t` / `.lvl` / `.lvl.candidate` / `.v` / `.q` — log line tokens
- `.candidates-pane` — flex column, gap 10px
- `.candidate-card` — compact cite-card variant
- `.candidate-card.weak` — border dashed cyan
- `.pipeline-footer-slate` — 4-column slate with NIM/Wiki/max-shots config

`@media (prefers-reduced-motion: reduce) { .now .scan { animation: none; } .candidate-card { animation: none; } }`

### Files unchanged

- All landing files (SP1).
- All backend pipeline modules NOT in the list above (shot_sampler, ingestor, verifier, palette, db, settings).
- `frontend/components/HeroForm.tsx`, `VideoPlayer.tsx`, `FilterBar.tsx`, `SummaryCard.tsx`, `ReferenceCard.tsx` (SP2).
- `frontend/lib/api.ts` — `subscribePipeline` signature unchanged; new events flow through the same EventSource handler.

## Component / data flow

```
ReportPage (router)
  ├── fetchReport(id) → Report | null
  ├── subscribePipeline(id, onEvent) → PipelineEvent[]
  └── if (report) → ReportContent
      else → PipelinePage
              ├── PipelineSlate (youtubeId, elapsedS)
              ├── pipeline-stage (3-col grid)
              │   ├── ClipMetadataPane (clipMeta, youtubeId)
              │   ├── PipelineList (stepStatuses)
              │   ├── NowFrame (lastVisionFrame, youtubeId)
              │   ├── KeyframeStrip (keyframes, analyzedIds, latestId)
              │   ├── LogPane (logLines)
              │   └── CandidatesPane (candidates)
              └── PipelineFooterSlate (static)
```

State derivation (all `useMemo` in `PipelinePage`):
- `clipMeta` — from latest `ingest` event payload, or null
- `shotsList` — from `shots` event payload.keyframes, or []
- `visionFrames` — events filtered by step `vision_frame`
- `lastVisionFrame` — `visionFrames[visionFrames.length - 1] ?? null`
- `analyzedIds` — `new Set(visionFrames.map(e => e.payload.frame_id))`
- `candidates` — events filtered by step `crossref_candidate`
- `logLines` — built from all events via `buildLogLines(events)` helper
- `stepStatuses` — from `classifySteps(events)` helper

`elapsedS` via `useElapsed` hook that captures the first event's `received_at` (frontend-side timestamp) and ticks every second.

## Error handling

1. **Pipeline error** — `error` event arrives; page.tsx sets `error` state; render error screen (slate top + serif-title + error message + link back to landing). Currently in scope from SP2 patterns.
2. **No keyframes detected** — pipeline raises before vision pass, emits `error` event; same path as above.
3. **Frame image 404** — already handled by SP2: `.thumb` background-color fallback + `<img onError>` hide.
4. **`subscribePipeline` connection error** — `onError` callback sets `error` state; user sees error screen.
5. **Reload after `done`** — `fetchReport` returns the persisted report; PipelinePage never renders.
6. **Race: `done` event arrives, then fetchReport returns null** — retry-once with 500ms backoff in the done handler.

## Edge cases

1. **Reload pendant pipeline running** — EventBus replay buffer covers ALL events (verified). Page rebuilds consistent state.
2. **Vision events arrive out of order** — components use `shot_index` from payload (KeyframeStrip), or "latest received" semantics (NowFrame, LogPane). No ordering assumption.
3. **`crossref_candidate` events arrive in burst** (~1s after merge) — CSS staggered fade-in compensates for the burst, gives "candidates surfacing" feel.
4. **`vision_frame` events arrive in batches** (concurrency=4) — React batches state updates; LogPane auto-scrolls on final batch, no jank.
5. **Captions count = 0** — ClipMetadataPane shows "Captions: none".
6. **Long `raw_description`** — truncated to 80 chars + "…" backend-side, no further truncation needed.
7. **Mobile viewport (≤900px)** — `.pipeline-stage` collapses to single column. Vertical scroll.
8. **Reduced motion** — scan animation + fade-in disabled via `@media (prefers-reduced-motion: reduce)`.
9. **Connection drop mid-pipeline** — EventSource auto-reconnects natively. Replay buffer re-yields all events from the start. Potential duplication on the frontend — see Risk below.
10. **EventBus replay pace with 100+ events** — at 0.18s × 100 = 18s, too slow. Adaptive pace mitigation in Task 1.

## Testing strategy

**Backend**

- `backend/tests/unit/test_orchestrator.py` (extend) — 3 new tests:
  - `test_ingest_event_includes_clip_metadata`
  - `test_shots_event_includes_keyframes_list`
  - `test_vision_frame_events_emitted_per_frame`
- `backend/tests/unit/test_frame_analyzer.py` (extend) — 1 new test:
  - `test_on_frame_callback_called_for_each_frame`
- `backend/tests/unit/test_ref_proposer.py` (extend) — 1 new test:
  - `test_on_candidate_callback_called_for_each_merged_candidate`

**Frontend**

- `frontend/lib/pipelineStats.test.ts` (NEW) — 3 tests:
  - `classifySteps_all_pending_when_no_events`
  - `classifySteps_vision_active_with_partial_frames`
  - `classifySteps_all_done_on_done_event`
- `frontend/components/pipeline/KeyframeStrip.test.tsx` (NEW) — 2 tests:
  - `renders_N_pending_cells_from_keyframes_list`
  - `marks_analyzed_when_frame_id_in_set`
- `frontend/components/PipelineStatus.test.tsx` (DELETE) — component removed.

**Net test delta**: backend +5, frontend +5 -2 = +3 frontend.

**Manual verification**:
1. Launch fresh analysis → redirect to `/report/{id}` → PipelinePage renders within 1s.
2. Slate: dot, ClipDecoder, "analysing", clip ID, elapsed counter ticks every second.
3. Left col: serif h2, clip metadata fills in within 1-2s, PipelineList shows progression with progress bars filling per step.
4. Center col: NowFrame transitions from "Awaiting first frame…" to first frame, updates on each `vision_frame`. Scan line animates. KeyframeStrip starts with all pending cells, thumbs appear progressively. LogPane scrolls bottom with each new event.
5. Right col: "No candidates yet…" → cards appear (staggered fade-in) when `crossref_candidate` events arrive.
6. When `done` arrives → page swaps to ReportContent (no flash).
7. Reload mid-pipeline → state replays consistent.
8. Mobile (≤900px) → single column verified.
9. Reduced motion → scan static, fade-in disabled.

## Done criteria

SP3 is complete when:

- ✅ Backend: `ingest` event payload extended with `title/channel/duration_s/captions_count`.
- ✅ Backend: `shots` event payload extended with `keyframes` list.
- ✅ Backend: `vision_frame` event emitted per frame with full payload.
- ✅ Backend: `crossref_candidate` event emitted per merged candidate.
- ✅ Backend: `frame_analyzer.analyze()` accepts `on_frame` callback param.
- ✅ Backend: `ref_proposer.propose()` accepts `on_candidate` callback param.
- ✅ Backend: 5 new tests pass.
- ✅ Frontend: `lib/types.ts` exposes typed payloads.
- ✅ Frontend: `lib/pipelineStats.ts` created with `classifySteps()` + 3 tests.
- ✅ Frontend: `app/report/[id]/page.tsx` simplified to slim router (~40 lines).
- ✅ Frontend: `components/report/ReportContent.tsx` extracted from old body.
- ✅ Frontend: `components/pipeline/` directory created with 8 components (PipelinePage, PipelineSlate, ClipMetadataPane, PipelineList, NowFrame, KeyframeStrip, LogPane, CandidatesPane, PipelineFooterSlate).
- ✅ Frontend: `components/PipelineStatus.tsx` + test deleted.
- ✅ Frontend: 2 new tests on KeyframeStrip pass.
- ✅ Frontend: `globals.css` extended with SP3 block (~150 lines).
- ✅ All existing tests pass (backend + frontend).
- ✅ Manual verification checklist passes end-to-end.
- ✅ Mobile + reduced motion verified.
- ✅ Branch `feature/design-system-sp3` merged into `main` after final review.

## Risks

- **EventBus replay pace** — with ~100 events per run × 0.18s pace = 18s replay. Bad UX for reload-mid-pipeline. Mitigation: implementer tunes `_REPLAY_PACE_S` adaptively in Task 1 (e.g., 0.04s for `vision_frame` / `crossref_candidate`, 0.18s for transitions; or universal 0.04s).
- **SSE reconnect duplication** — EventSource native reconnect may redispatch all events from `_history`. Could create duplicates in the frontend log. Mitigation: dedup by `(step, payload.frame_id)` or `(step, message, progress)` hash in the frontend. Implementer audits in Task 1.
- **80-event burst from vision pass** — at concurrency=4, ~4 events/sec for 20s. React handles fine; LogPane uses memoized buildLogLines so render cost stays low.
- **PR scope** — SP3 touches ~12 frontend files + 4 backend files. Plan decomposes into ~12-15 tasks.
- **Captions exposure** — `IngestResult.captions: list[Caption]` already exists; payload adds `captions_count: len(ingest.captions)`. No new ingestor work.

## Out of scope (Tier 5 deferred)

- Cancel button (DELETE endpoint + pipeline task cancellation)
- Estimated remaining time (timing model)
- NIM credits tracking
- Per-shot extraction events
- Verify pass per-ref events
- Config endpoint (so footer slate shows real `nim_concurrency`, `wikipedia_verification`, `max_shots_per_video` from `settings`)
- Reference detail page (SP4)
- Error page polish + cookies retry (SP5)
