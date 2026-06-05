# Lyrics × Visuals — linking the clip to its lyrics

**Date:** 2026-05-27
**Status:** Approved design, pending implementation plan

## Goal

Add a report section that explains the links between a music video's
imagery and its lyrics: for notable lyric lines, show what is on screen at
that moment and a one-line reading of *how* the visual relates to the words
(literal illustration, recurring motif, ironic contrast, emotional
amplification).

This is a complementary, interpretive layer alongside the existing named
visual references — it answers "how does this clip stage its own song?"
rather than "what other works does it quote?".

## Decisions (resolved during brainstorming)

| Question | Decision |
| --- | --- |
| Lyrics source | **YouTube auto-captions** (yt-dlp, `json3`). Free, no API key, carries timestamps for moment alignment. |
| Section form | **Moment-by-moment timeline** — lyric line + on-screen frame + relation tag + one-line note. |
| When produced/shown | **Report-only.** Computed in the pipeline, surfaced only in the final report. No live pane; a log line is acceptable. |
| Computation | **Approach A — a dedicated LLM stage** (`lyrics_linker`), one extra NIM call, toggleable via env flag. Mirrors `wikidata_enricher` / `verifier` structure. |
| Page integration | **Tabs** (References / Lyrics × Visuals) in the same content region, so total page height does not grow. |

## Non-goals (YAGNI)

- No live streaming of links during the run (no new SSE event type, no new
  pipeline pane).
- No lyrics provider beyond auto-captions (no lrclib/Genius/Musixmatch, no
  user-paste textarea). Clips without captions simply skip the feature.
- No per-reference-card integration; this is a standalone tab.
- No editing/curation of links by the user.

## Data model

### Backend — `backend/app/models.py`

```python
class LyricLink(BaseModel):
    lyric_timestamp_s: Annotated[float, Field(ge=0.0)]  # for player seek
    lyric: str                                          # the lyric line
    frame_id: str                                       # matched shot_NN
    frame_timestamp_s: Annotated[float, Field(ge=0.0)]
    relation: str   # literal | motif | contrast | amplification | other
    note: str       # one-line reading of the connection
```

`Report` gains:

```python
    lyrics_links: list[LyricLink] = []
```

`Report` is persisted as a JSON column (`AnalysisRow.report_json` via
`report.model_dump_json()`), so **no DB migration is required** — old rows
deserialize with `lyrics_links == []` by default.

The existing `Caption` model is reused as-is for sourcing.

### Frontend — `frontend/lib/types.ts`

```ts
export interface LyricLink {
  lyric_timestamp_s: number;
  lyric: string;
  frame_id: string;
  frame_timestamp_s: number;
  relation: string;
  note: string;
}

// Report gains:
  lyrics_links?: LyricLink[];
```

### Relation taxonomy

Closed set, validated/normalized in the linker (unknown → `other`):

- `literal` — the visual literally depicts what the lyric says.
- `motif` — a recurring symbol/palette tied to the lyric's theme.
- `contrast` — the visual contradicts or ironizes the lyric.
- `amplification` — the visual heightens the lyric's emotion.
- `other` — a real but uncategorized connection.

## Lyrics sourcing — `backend/app/pipeline/ingestor.py`

Re-enable auto-caption retrieval (currently `captions=[]`,
`writeautomaticsub: False`):

- `_ydl_opts` gains `writeautomaticsub: True`, `writesubtitles: True`,
  `subtitlesformat: "json3"`, and a language preference:
  video language (`info.get("language")`) → `en` → first available key in
  `automatic_captions` / `subtitles`.
- After `extract_info(url, download=True)`, locate the produced
  `<id>.<lang>.json3` in the work dir and parse it into `list[Caption]`.
- **Normalization:** YouTube `json3` emits overlapping rolling segments.
  Coalesce them into clean, de-duplicated lines; drop bracketed
  non-lyric markers (`[Music]`, `[Applause]`, …); collapse whitespace.
- Delete the subtitle file the same way the mp4 is deleted after frame
  extraction (no new permanent on-disk artifact).
- If no caption track exists, `captions=[]` and the whole feature degrades
  gracefully (no links, no tab).

**Bonus:** populating `captions` also revives the existing-but-dead
`lyrics_text` input to the cross-ref prompt (`orchestrator` already joins
`ingest.captions` into `lyrics`), at no extra cost.

Parsing lives in a small pure helper (e.g. `_parse_json3(text) ->
list[Caption]`) so it is unit-testable without yt-dlp.

## Linker stage — `backend/app/pipeline/lyrics_linker.py`

New module + prompt `backend/app/prompts/lyrics_linker.md`, following the
`RefProposer` shape.

```python
class LyricsLinker:
    def __init__(self, nim_client: NimClient, model: str): ...

    async def link(
        self,
        *,
        title: str,
        captions: list[Caption],
        frame_analyses: list[FrameAnalysis],
        max_links: int = 10,
        on_progress: Callable[[str, float], Awaitable[None]] | None = None,
    ) -> list[LyricLink]:
        ...
```

Behaviour:

- **Short-circuit:** empty `captions` → return `[]` immediately (no NIM
  call).
- Build a prompt with the timestamped lyric lines and the timestamped frame
  summaries (reuse the `_format_frame_summaries` pattern).
- One `LLM_MODEL` NIM call, `json_mode=True`, returning a `links` array.
- Validate each item into `LyricLink`; drop invalid items (same tolerant
  pattern as `RefProposer._call`).
- Drop any link whose `frame_id` is not in the frame index.
- Normalize `relation` to the closed set (unknown → `other`).
- Cap to `max_links`.
- Best-effort: any exception is logged and yields `[]` — this feature must
  never fail an otherwise-successful run.

## Orchestration — `orchestrator.py` + `main.py`

- `main.py`: inject `lyrics_linker=LyricsLinker(nim_client=nim,
  model=settings.llm_model) if settings.lyrics_linking else None`, mirroring
  the `enricher` gate.
- `orchestrator.run`: after Wikidata enrichment and before building the
  `Report`, if a linker is configured and captions exist, call
  `link(...)`; store the result on `Report.lyrics_links`.
- Emit log-only progress with `step="lyrics"` (e.g. "Linking lyrics to
  visuals…"). This is a **log line, not a stage band** — confirm
  `classifySteps` / the pipeline stage list ignores unknown steps gracefully
  (it tails the log); if it does not, reuse the `verify` step channel the
  way enrichment does.

## UI — report page

### New component `frontend/components/report/LyricsTimeline.tsx`

Vertical list of rows; each row:

- Clickable `mm:ss` timestamp → seeks the player to `lyric_timestamp_s` and
  scrolls to the player (reuse the existing jump-to-player behaviour).
- Small source-frame thumbnail (`/api/frames/{youtubeId}/{frame_id}`).
- The lyric line rendered as a serif quote.
- A relation chip (styled per design system, like the verdict chips).
- The one-line note.

### Tabs in `ReportContent.tsx`

- Add a tab selector below the player/summary section: **References** /
  **Lyrics × Visuals**. Styled like the existing `FilterBar` chips
  (`aria-selected`/`aria-pressed`), within the design system.
- **References tab** → the existing `FilterBar` + reference grid (the
  `FilterBar` is scoped to this tab — it only filters references).
- **Lyrics × Visuals tab** → `LyricsTimeline`.
- Default tab: **References**.
- If `report.lyrics_links` is empty/absent, **render no tabs at all** — show
  the references exactly as today (zero visual change for caption-less
  clips).
- Tab state is local client state in `ReportContent`. Total page height is
  unchanged versus today because only one tab's content renders at a time.

The player + summary header stays fixed above the tabs and is shared by both
tabs.

## Config + docs

- `backend/app/settings.py`: `lyrics_linking: bool = True`,
  `max_lyric_links: int = 10`.
- `.env.example`: `LYRICS_LINKING=true`.
- `README.md`:
  - "How it works" — describe the new linking step.
  - "Configuration" — document `LYRICS_LINKING` and `MAX_LYRIC_LINKS`.
  - Note that auto-captions are now downloaded, and clips without captions
    skip the section.
  - "Data retention" — the subtitle file is deleted alongside the mp4 (no
    new permanent artifact).

## Testing

**Backend (pytest):**

- `_parse_json3`: a fixture of YouTube `json3` with overlapping rolling
  segments + `[Music]` markers → expected clean `list[Caption]`.
- `LyricsLinker.link` (respx-mocked NIM):
  - happy path → validated `LyricLink` list, capped at `max_links`;
  - empty captions → `[]` with **no** NIM call made;
  - link with a non-existent `frame_id` → dropped;
  - unknown `relation` → normalized to `other`;
  - NIM error → `[]` (best-effort), not a raise.

**Frontend (vitest/RTL):**

- `LyricsTimeline` renders one row per link with timestamp, lyric, note,
  relation chip.
- Clicking a row's timestamp calls the seek/jump handler with
  `lyric_timestamp_s`.
- `ReportContent`: tabs appear only when `lyrics_links` is non-empty;
  default tab is References; switching tabs swaps content; the `FilterBar`
  is present only on the References tab.

## Affected files (summary)

**Backend**
- `app/models.py` — `LyricLink`, `Report.lyrics_links`.
- `app/pipeline/ingestor.py` — re-enable auto-captions, `_parse_json3`,
  normalization, subtitle-file cleanup.
- `app/pipeline/lyrics_linker.py` *(new)*.
- `app/prompts/lyrics_linker.md` *(new)*.
- `app/pipeline/orchestrator.py` — call the linker, store links, log step.
- `app/main.py` — inject `lyrics_linker` gated by `settings.lyrics_linking`.
- `app/settings.py` — `lyrics_linking`, `max_lyric_links`.
- `tests/unit/test_ingestor.py` (or new) — `_parse_json3`.
- `tests/unit/test_lyrics_linker.py` *(new)*.

**Frontend**
- `lib/types.ts` — `LyricLink`, `Report.lyrics_links`.
- `components/report/LyricsTimeline.tsx` *(new)* + test.
- `components/report/ReportContent.tsx` — tabs, scope `FilterBar`.

**Docs / config**
- `.env.example`, `README.md`.
