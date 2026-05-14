# Reference Detail v2 — In-page video player + Wikidata multilingual + non-art work_types

> Three deferred items from SP4's "Out of scope" rolled into a single, focused effort against the reference detail experience.

## Goal

Make the reference detail page (`/report/[id]/ref/[n]`) richer and more usable in two ways:

1. **In-page video player.** Replace the static frame thumbnail on the left pane of `DetailCompare` with the existing `VideoPlayer`, auto-seeked to the reference's `timestamp_s`. The user no longer has to bounce back to the report page to scrub.
2. **Better Wikidata enrichment.** The `WikidataEnricher` (a) prefers French labels over English ones when both exist, and (b) dispatches to the right Wikidata properties based on the reference's `work_type` (film → P136/P272/P577, music_video → P31/P264/P577, etc.), instead of always assuming a painting-shaped record.

## Out of scope

- **Multi-language UI toggle.** Only a single language is stored per field (FR if available, else EN). No `dict[lang, value]` in the model, no language picker on the report or detail page.
- **New Pydantic fields.** `medium`, `institution`, and `inception_year` are reused for all work_types. No `director`, `record_label`, etc. The existing 3 fields are expressive enough when fed the right P-codes.
- **Backfill of existing DB records.** Reports enriched before this change keep whatever they had (English, painting-shaped). The new behaviour only applies to fresh runs. We are in dev — the user reruns or seeds.
- **Replacing the JUMP button on the report page.** `ReferenceCard.onJump` continues to seek the inline player on `/report/[id]`. Only the JUMP button on the detail page is removed (the in-page player makes it redundant).
- **Wikidata edge cases on non-art types** beyond the 8 documented `work_type` values. Unknown work_types fall back to the painting mapping.

## Decisions matrix

| Decision | Choice | Rationale |
| --- | --- | --- |
| Spec packaging | One spec, one PR covering all 3 items | The three changes are cohesive (all touch the reference detail surface) and small enough to ship together without a giant diff. |
| Language strategy | Single string per field, FR→EN fallback at enrichment time | Smallest model footprint. Matches the user's locale without a UI toggle. No DB migration. |
| Multi-language fetch | `?languages=fr\|en` on the Wikidata REST entity endpoint | One round-trip per QID, both labels returned together. Pick FR if present, EN otherwise. |
| Work_type mapping | Internal dispatch dict `_PROPS_BY_WORK_TYPE` in the enricher module | More expressive than the current ad-hoc `or` fallbacks. Lives next to the resolver code so the mapping is obvious. Beats a YAML config file (YAGNI). |
| Unknown work_type | Falls back to painting's P-codes (`_DEFAULT_PROPS`) | Graceful default. Logs nothing — the enricher's "field is None when Wikidata had nothing" guarantee still holds. |
| Video player tech | Reuse the existing `VideoPlayer` component (with `forwardRef` + `seekTo` handle) | Already proven on the report page. Avoids duplicating YouTube iframe API plumbing. |
| Player initial state | Paused at `timestamp_s`, mute off (browser default) | The user explicitly clicked into a reference detail page — they're inspecting, not auto-watching. |
| JUMP button on detail page | Removed | The player is on the page; the button becomes a no-op. |

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  backend/app/pipeline/wikidata_enricher.py                         │
│                                                                    │
│  enrich(ref) ─► picks _PROPS_BY_WORK_TYPE[ref.work_type]          │
│         │                                                          │
│         ├─► for each {medium, institution, inception_year}:       │
│         │     try each P-code in order, first hit wins             │
│         │                                                          │
│         └─► _fetch_labels(qids, langs=["fr","en"])                │
│               └─► label = entity.labels.fr ?? entity.labels.en    │
└────────────────────────────────────────────────────────────────────┘
                            │
                            ▼ (VerifiedReference model — unchanged)
┌────────────────────────────────────────────────────────────────────┐
│  frontend/components/report/detail/DetailCompare.tsx               │
│                                                                    │
│  left pane:                                                        │
│    OLD: <div class="img"><img src="/api/frames/..."/></div>       │
│    NEW: <div class="img"><VideoPlayer ref={r} youtubeId=...     │
│                                              /></div>              │
│                                                                    │
│    useEffect(() => r.current?.seekTo(reference.timestamp_s),      │
│              [reference.timestamp_s])                              │
│                                                                    │
│  frontend/components/report/detail/DetailTopRow.tsx                │
│    JUMP button removed; onJump prop removed from signature        │
└────────────────────────────────────────────────────────────────────┘
```

No change to: `VerifiedReference` Pydantic model, DB schema, REST API surface, `/report/[id]` page, `ReferenceCard`, `VideoPlayer` itself.

## Backend — `wikidata_enricher.py`

### Multilingual label fetch

The module already calls the Wikidata REST entity endpoint to resolve QIDs to labels. Change the single-language fetch to multilingual:

```python
# Today (effectively):
url = f"{WIKIDATA_REST}/entities/items/{qid}?languages=en"

# New:
url = f"{WIKIDATA_REST}/entities/items/{qid}?languages=fr|en"
```

The response shape is the same — `entity.labels` is a `{lang_code: string}` map. Resolver picks `fr` if present, falls back to `en`, falls back to `None`:

```python
def _pick_label(labels: dict[str, str]) -> str | None:
    return labels.get("fr") or labels.get("en") or None
```

No batching change — the existing `_fetch_labels` helper keeps its signature; only its internal URL builder and label resolution change.

### Per-work_type property dispatch

Replace the ad-hoc inline fallbacks (today: `P276 or P272`, `P571 or P577`) with a single config table at module top:

```python
_PROPS_BY_WORK_TYPE: dict[str, dict[str, list[str]]] = {
    "painting":          {"medium": ["P186"], "institution": ["P276"],         "inception": ["P571"]},
    "photograph":        {"medium": ["P186"], "institution": ["P276"],         "inception": ["P571", "P577"]},
    "film":              {"medium": ["P136"], "institution": ["P272"],         "inception": ["P577", "P571"]},
    "music_video":       {"medium": ["P31"],  "institution": ["P264", "P272"], "inception": ["P577"]},
    "album_cover":       {"medium": ["P186"], "institution": ["P264"],         "inception": ["P577"]},
    "fashion_editorial": {"medium": ["P186"], "institution": ["P1433"],        "inception": ["P577", "P571"]},
    "ad_campaign":       {"medium": ["P31"],  "institution": ["P1056"],        "inception": ["P577"]},
    "archival_footage":  {"medium": ["P31"],  "institution": ["P123"],         "inception": ["P577"]},
}
_DEFAULT_PROPS = _PROPS_BY_WORK_TYPE["painting"]
```

Property reference:
- **P31** instance of — used as a "format" descriptor for things without a P186 medium (e.g. instance of "music video", "advertisement", "archival footage")
- **P136** genre — closest to "medium" for films
- **P186** material/medium — canonical for art
- **P264** record label, **P272** production company, **P276** location, **P123** publisher, **P1056** product, **P1433** published in
- **P571** inception, **P577** publication date

`enrich()` looks up `_PROPS_BY_WORK_TYPE.get(ref.work_type, _DEFAULT_PROPS)` and walks each field's P-code list, first non-null wins. The existing inline `or` chains in `enrich()` go away.

### Graceful degradation

- Unknown `work_type` → uses `_DEFAULT_PROPS` (painting). No log, no exception.
- Wikidata returns no claim for any of the listed P-codes → field stays `None`.
- Wikidata API call fails (HTTP error, timeout) → field stays `None`, orchestrator continues. Current behaviour preserved.

## Frontend — DetailCompare + DetailTopRow

### `DetailCompare.tsx`

Replace the left-pane `<img>` with a `VideoPlayer` whose `seekTo` handle is called at mount and at every change of `reference.timestamp_s`:

```tsx
const playerRef = useRef<VideoPlayerHandle>(null);
useEffect(() => {
  playerRef.current?.seekTo(reference.timestamp_s);
}, [reference.timestamp_s]);

<div className="img">
  <VideoPlayer ref={playerRef} youtubeId={youtubeId} />
</div>
```

Ensure the `.detail-pane .img` CSS rule has `aspect-ratio: 16 / 9` so the iframe gets a height on first paint. Today the rule sizes itself off the `<img>`'s natural dimensions; an iframe has none until YouTube populates it, so the explicit ratio is required.

Prev/Next navigation through the keyboard nav hook re-renders `DetailCompare` with a new `reference` prop. The `useEffect` dependency picks this up and re-seeks the already-mounted player — no full remount of the iframe.

### `DetailTopRow.tsx`

The JUMP button is removed. The `onJump` prop disappears from the component's signature and from its parent (`ReferenceDetail`). Other actions in the top row (the verdict line, the serif title) are unchanged.

`ReferenceCard.onJump` and the report page's seek behaviour are not touched — they're a separate code path.

## Data flow

```
┌─ fresh analysis ───────────────────────────────────────────────┐
│ verifier produces VerifiedReference (work_type, qid, ...)      │
│         │                                                       │
│         ▼                                                       │
│ WikidataEnricher.enrich(ref)                                   │
│   ├─ table = _PROPS_BY_WORK_TYPE.get(ref.work_type, DEFAULT)   │
│   ├─ for field in (medium, institution, inception_year):       │
│   │    for p_code in table[field]:                             │
│   │      claim = claims.get(p_code)                            │
│   │      if claim: ref.<field> = resolve(claim); break         │
│   └─ resolve(qid) → _fetch_labels(qid, langs=["fr","en"])      │
│                       → pick fr || en || None                  │
└────────────────────────────────────────────────────────────────┘

┌─ user opens /report/[id]/ref/[n] ──────────────────────────────┐
│ ReferenceDetail receives ref + frame                           │
│         │                                                       │
│         ▼                                                       │
│ DetailCompare mounts <VideoPlayer ref=playerRef ...>           │
│   └─ useEffect → playerRef.seekTo(ref.timestamp_s)             │
│                                                                 │
│ DetailTopRow renders verdict line + title (no JUMP)            │
└────────────────────────────────────────────────────────────────┘
```

## Tests

### Backend — `backend/tests/unit/test_wikidata_enricher.py`

| Test | Status |
| --- | --- |
| Existing: painting, EN-only mock | Update mocked URL to `?languages=fr\|en`; assertion values unchanged |
| New: FR label wins over EN when both present | Mock returns `{fr: "huile sur toile", en: "oil on canvas"}` → enricher stores `"huile sur toile"` |
| New: EN fallback when FR missing | Mock returns `{en: "oil on canvas"}` only → enricher stores `"oil on canvas"` |
| New: non-art (film) properties resolve | `work_type="film"`, Wikidata mock provides P136 + P272 + P577 → `medium`, `institution`, `inception_year` all set |
| New: non-art (music_video) properties resolve | `work_type="music_video"`, mock provides P31 + P264 + P577 → fields set |
| New: unknown work_type falls back to painting | `work_type="weird_thing"` → no crash, uses P186/P276/P571 |
| New: P-code absent → field stays None | `work_type="film"` but Wikidata has neither P136 nor P31 → `medium=None`, others unaffected |

Expected delta: 85 → ~91 backend tests.

### Frontend — `frontend/components/report/detail/DetailCompare.test.tsx`

| Test | Status |
| --- | --- |
| Mock `@/components/VideoPlayer` with `forwardRef` + `useImperativeHandle` (mirrors `ReportContent.test.tsx`'s pattern) | New helper at top of file |
| New: `seekTo` is called at mount with `reference.timestamp_s` | Renders with `timestamp_s=42.5`, asserts spy receives `42.5` |
| New: `seekTo` is called again when the reference changes | Re-renders with `timestamp_s=88.0`, asserts spy receives `88.0` |

Any existing assertions on the `<img>` element are removed; the equivalent assertion becomes "the mocked `VideoPlayer` was rendered with the expected `youtubeId`".

Expected delta: 35 → ~37 frontend tests.

### Out of scope for tests

- E2E test that drives a real YouTube iframe and asserts playback — too brittle, network-dependent. Covered by manual smoke.
- Wikidata API contract test (live HTTP) — the unit tests with `respx` mocks are enough; the API is stable.

## Rollout

1. **No DB migration.** Existing reports keep their English/painting-shaped enrichment. New runs produce FR-preferred, work_type-aware enrichment.
2. **`seed_fixture.py`** continues to work — the script writes literal values bypassing the enricher.
3. **Manual smoke checklist:**
   - Re-run an analysis on a film clip → verify `medium` and `institution` are populated with film-relevant Wikidata fields.
   - Open `/report/[id]/ref/[n]` → verify the YouTube player loads and is parked at the correct timestamp.
   - Click prev/next in the detail page → verify the player re-seeks to the new timestamp without remounting.
   - Verify the JUMP button is absent from the detail top row.
   - Verify the JUMP button is still present and functional on the `/report/[id]` reference cards.
