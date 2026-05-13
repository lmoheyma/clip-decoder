# Design System Migration — Sub-project 4: Reference detail page

> Fourth sub-project of the 5-sub-project design refactor (`index.html` + `styles.css` at repo root). SP1–SP3 are merged. SP4 builds a dedicated reference-detail page (frame 04 of the mockup, "REFERENCE DETAIL · expanded card / focus mode"), reached by clicking any `ReferenceCard` on the report grid.

## Goal

Give each reference its own page so the user can:
- Read the full reasoning split into the three editorial sections the mockup shows (Cross-reference / Adversarial / Wikipedia), instead of one collapsed paragraph.
- See the work's medium, institution, and inception year next to its title, sourced from Wikidata.
- Compare the source frame and the proposed reference work side by side, with the full frame analysis (composition, palette, camera, etc.) visible.
- Navigate between references with PREV / NEXT / ESC.

The page is deep-linkable: `/report/{id}/ref/{n}` is a real URL that survives reloads, bookmarks, and shares.

## Out of scope

- **Reference detail page-internal video player** → SP5 or beyond. JUMP currently sends the user back to `/report/{id}` with a hash that the report page consumes to seek the embedded player.
- **Multi-language Wikidata labels** → only `lang=en` for now.
- **Wikidata for non-art reference types** (films, music albums) → handled the same way (Wikidata returns whatever claims it has, fields default to null when missing). No special-cased pipeline per work_type.
- **Backward compat for old report JSON in DB.** We are in dev. Existing reports become invalid Pydantic shapes; the user reruns or clears the DB. No fallback validator.

## Decisions matrix

| Decision | Choice | Rationale |
| --- | --- | --- |
| Route shape | `/report/[id]/ref/[n]/page.tsx` (App Router segment) | URL partageable, deep-linkable, scroll restoration handled by Next.js. Beats modal/overlay. |
| Index semantics for `n` | Position in `report.references` as stored — guaranteed equal to visual card order by sorting `references` by `timestamp_s` in the orchestrator before saving (see Backend §4) | Stable across reloads and consistent between deep-link and grid click. |
| Reasoning split | Refactor verifier prompt to output `cross_ref_reasoning`, `adversarial_reasoning`, `wikipedia_reasoning` in one LLM call | Same cost as today. The model already reasons adversarially when the prompt asks. Beats heuristic split or a 3rd LLM pass. |
| Medium / institution / inception | New `WikidataEnricher` module, called after `verify_all` in the orchestrator | Wikidata exposes structured claims (P186 material, P276 location, P571 inception). Reliable and free. |
| Code structure | Approach B — Enricher is its own module, Verifier only changes for the reasoning fields | Single responsibility per module. Verifier stays focused on verdict + reasoning; Enricher focuses on external metadata. |
| Image of the reference work | `wikipedia_thumbnail_url` (already in `VerifiedReference`) | We already fetch it. No new API. Placeholder when null. |
| Page rendering | Server component fetches the report; passes to client `ReferenceDetail` | SSR snappy, no flash. The report page stays the special case (needs SSE during loading). |
| Hidden references | Accessible by direct URL | The page is filter-neutral. Filters live on the report grid. |

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  /report/[id]                                                    │
│  ┌──────────────┐  click card                                   │
│  │ ReferenceCard├──────────► router.push('/report/[id]/ref/[n]')│
│  └──────────────┘                                                │
│  (button "▸ JUMP TO" still seeks the inline player)             │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  /report/[id]/ref/[n]                  (server component)        │
│  ─ fetch report on the server                                    │
│  ─ parse n, validate, notFound() if invalid                      │
│  ─ render <ReferenceDetail report={report} index={n} />          │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  <ReferenceDetail>          (client component)                   │
│   ┌─ DetailSlate         (PREV / NEXT / ESC + position)         │
│   ├─ DetailTopRow        (verdict line, title, action buttons)  │
│   ├─ DetailCompare       (frame ↔ work, side by side)           │
│   └─ DetailEvidence      (reasoning + frame analysis dl)        │
└──────────────────────────────────────────────────────────────────┘
```

Backend pipeline (only the post-vision tail changes):

```
ingest → shots → vision → vision_frame ×N → crossref → crossref_candidate ×M
       → verify ×M  ◄── refactored: 3 reasoning fields
       → enrich ×M  ◄── new: WikidataEnricher
       → done
```

## Backend changes

### 1. Pydantic models (`backend/app/models.py`)

`reasoning` currently lives on `ReferenceCandidate` (line 65), which `VerifiedReference` inherits from. Both ends of the pipeline need to change:

**`ReferenceCandidate`** — remove `reasoning: Annotated[str, Field(min_length=1)]`. The ref_proposer prompt must be updated in lock-step (see Backend §2.5) so the candidate JSON no longer contains a `reasoning` key. Existing tests that assert on `candidate.reasoning` must be adapted.

**`VerifiedReference(ReferenceCandidate)`** — adds:
- `cross_ref_reasoning: str`
- `adversarial_reasoning: str`
- `wikipedia_reasoning: str`
- `medium: str | None = None`        (e.g. "oil on canvas")
- `institution: str | None = None`   (e.g. "Museum of Modern Art")
- `inception_year: int | None = None`

The three Wikidata fields default to `None` so the schema accepts non-enriched refs (no Wikipedia URL, or Wikidata fails). The three reasoning fields are required (no fallback validator — see Out of scope).

### 2. Verifier refactor (`backend/app/pipeline/verifier.py`)

Three changes, in order:

**2a. `_wiki_lookup` returns the summary extract too.** Today it returns `(page_url, thumb_url)` and discards `data["extract"]`. Change the signature to `(page_url, thumb_url, summary_extract)` and capture `data.get("extract", "")`. All three default to `None`/`""` on failure.

**2b. Reorder the verify-one flow.** Today: LLM call → wiki lookup (gated on `verdict != REJECT`). New: **wiki lookup first**, then LLM call **with the summary text in context**. The LLM uses the summary to produce `wikipedia_reasoning`; the lookup must therefore happen unconditionally for every candidate (cheap, cached by Wikipedia's CDN). Removed: the `if self._wiki and verdict is not Verdict.REJECT:` gate.

**2c. New verifier prompt (`backend/app/prompts/verifier.md`)**.

The current prompt produces `{verdict, supporting_elements, final_confidence, rationale}`. Of those, only `verdict` and `supporting_elements` are read by `_verify_one` today; `final_confidence` and `rationale` are unused. The new prompt drops both unused fields and adds the three reasoning fields:

```
{
  "verdict": "keep" | "speculative" | "reject",
  "supporting_elements": ["...", "..."],
  "cross_ref_reasoning": "<defend the match using concrete frame elements>",
  "adversarial_reasoning": "<argue against the match — what would make this wrong?>",
  "wikipedia_reasoning": "<is the candidate consistent with the supplied Wikipedia summary?>"
}
```

The prompt template gains a new `{wikipedia_summary}` placeholder. If `summary_extract` is empty, the orchestrator passes `"(no Wikipedia article available)"` and instructs llama in the prompt to write a matching one-line note in `wikipedia_reasoning`.

`_verify_one` constructs `VerifiedReference(**candidate.model_dump(), **llama_output, wikipedia_url=…, wikipedia_thumbnail_url=…)`. Pydantic enforces all three reasoning fields are present. ValidationError → ref dropped (existing `verify_all` `return_exceptions=True` handler).

**2.5. ref_proposer prompt** (`backend/app/prompts/ref_proposer.md` + `ref_proposer_complement.md`) — drop the `reasoning` field from the candidate output JSON. Update tests in `test_ref_proposer.py` that assert on `candidate.reasoning`.

### 3. New module: WikidataEnricher (`backend/app/pipeline/wikidata_enricher.py`)

**HTTP etiquette** — reuse the existing `WIKI_USER_AGENT` constant defined in `verifier.py` (move it to a shared module or import directly). Wikipedia/Wikidata APIs expect a custom User-Agent identifying the client.

```python
class WikidataEnricher:
    def __init__(self, *, concurrency: int = 4):
        self._sem = asyncio.Semaphore(concurrency)

    async def enrich(
        self,
        refs: list[VerifiedReference],
        on_progress: Callable[[str, float], Awaitable[None]] | None = None,
    ) -> list[VerifiedReference]:
        ...
```

Per-ref flow (skip silently if `ref.wikipedia_url` is None):

1. **Extract slug from `wikipedia_url`** — e.g. `https://en.wikipedia.org/wiki/Le_faux_miroir` → `Le_faux_miroir`.
2. **Wikipedia → Wikidata QID** — call `https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&format=json&titles=<slug>` and read `pageprops.wikibase_item`. If absent, return the ref unchanged.
3. **Wikidata claims** — call `https://www.wikidata.org/wiki/Special:EntityData/<QID>.json` and extract:
   - `P186` (material used) → claims may have several statements (canvas + oil, etc.); pick deterministically: highest `rank` first ("preferred" > "normal" > "deprecated"), then first by JSON order. Resolve the QID via `wbgetentities`.
   - `P276` (location) → same deterministic selection rule.
   - `P571` (inception) → claim's `time` field (ISO date like `"+1929-00-00T00:00:00Z"`) → parse the year (leading `+` allowed, BC dates negative). Same rank/order rule if multiple.
4. **Resolve QIDs to English labels** — batch via `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q123|Q456&props=labels&languages=en&format=json`.
5. Return a new `VerifiedReference` with `medium`, `institution`, `inception_year` filled (or null if any step failed for this field).

Concurrency: `asyncio.Semaphore(self._concurrency)`. `asyncio.gather(*[..], return_exceptions=True)` — a single ref failure does not abort the rest.

`on_progress` fires per ref: `"Enriched X/N · {title} → {medium or '—'}"` so the LogPane reflects activity.

### 4. Orchestrator (`backend/app/pipeline/orchestrator.py`)

After `verify_all`, before saving the report:

```python
await self._emit(yid, "verify", f"Enriching {len(verified)} with Wikidata", 0.95)
try:
    enriched = await self._enricher.enrich(
        verified, on_progress=_on_verify_progress
    )
except Exception:
    logger.exception("wikidata enrichment failed")
    enriched = verified  # graceful degrade: all medium/institution stay None
enriched.sort(key=lambda r: r.timestamp_s)  # stable visual order
```

The `sort` guarantees `report.references[n]` lines up with the n-th card the user sees on the report grid, since `ReportContent.tsx` already sorts the same way at render time. This makes the deep-link `/report/{id}/ref/0` always resolve to the visually-first card. `Report.references = enriched`, then existing save/done flow.

### 5. Settings (`backend/app/settings.py`)

```python
wikidata_enrichment: bool = True       # toggle for tests
wikidata_concurrency: int = 4
wikidata_timeout_s: float = 10.0
```

When `wikidata_enrichment` is False, the orchestrator skips the enrich call and `enriched = verified` directly. Used in tests to avoid hitting Wikidata. Naming note: parallel to the existing `wikipedia_verification` setting (which controls the verifier's Wikipedia URL/thumb lookup). The two are independent — Wikipedia verification can stay on while Wikidata enrichment is off, useful when only the URL+thumbnail+summary are needed.

### 6. main.py wiring

```python
enricher = WikidataEnricher(concurrency=settings.wikidata_concurrency)
orch = Orchestrator(..., enricher=enricher)
```

## Frontend changes

### Type updates (`frontend/lib/types.ts`)

```ts
export interface VerifiedReference {
  // existing fields except `reasoning` (REMOVED):
  timestamp_s: number;
  source_frame_id: string;
  work_title: string;
  work_creator: string;
  work_year: number | null;
  work_type: string;
  raw_confidence: number;
  verdict: Verdict;
  final_confidence: Confidence;
  supporting_elements: string[];
  wikipedia_url: string | null;
  wikipedia_thumbnail_url?: string | null;

  // NEW:
  cross_ref_reasoning: string;
  adversarial_reasoning: string;
  wikipedia_reasoning: string;
  medium: string | null;
  institution: string | null;
  inception_year: number | null;
}
```

### Route: `frontend/app/report/[id]/ref/[n]/page.tsx` (server component)

```tsx
import { notFound } from "next/navigation";
import { fetchReportServer } from "@/lib/api-server";
import { ReferenceDetail } from "@/components/report/detail/ReferenceDetail";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; n: string }>;
}) {
  const { id, n } = await params;
  const idx = Number.parseInt(n, 10);
  if (Number.isNaN(idx) || idx < 0) notFound();
  const report = await fetchReportServer(id);
  if (!report || idx >= report.references.length) notFound();
  return <ReferenceDetail report={report} index={idx} />;
}
```

**`frontend/lib/api-server.ts` (new)** — the existing `fetchReport` in `lib/api.ts` uses the relative URL `/api/report/${id}`, which works only in the browser. Server components need an absolute URL. New helper:

```ts
import "server-only";
import type { Report } from "./types";

export async function fetchReportServer(youtubeId: string): Promise<Report | null> {
  const base =
    process.env.INTERNAL_API_BASE_URL ?? "http://backend:8000";
  const r = await fetch(`${base}/api/report/${encodeURIComponent(youtubeId)}`, {
    cache: "no-store",
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`report failed: ${r.status}`);
  return (await r.json()) as Report;
}
```

`INTERNAL_API_BASE_URL` defaults to the docker-compose service name (`backend`) — same hostname used by the existing `/api/*` rewrites in `next.config.ts`. `cache: "no-store"` because a stale report payload during pipeline reruns would surface stale references.

### Component: `frontend/components/report/detail/ReferenceDetail.tsx` (client)

Wires the four sub-components, owns:
- `useRouter` for PREV / NEXT / ESC navigation
- `useEffect` keyboard listener (ArrowLeft / ArrowRight / Escape) — uses `router.push`
- `frameById = useMemo(... report.frame_analyses ...)` for fast lookup
- `handleJump()` → `router.push('/report/{id}#t={timestamp_s}')` (the report page's existing seek mechanism handles the hash; if it doesn't yet, add a small `useEffect` there that seeks on mount when `window.location.hash` matches `#t=NN`)
- `handleFlag()` → existing `flagReference(youtubeId, idx)`

### Sub-components in `frontend/components/report/detail/`

- **`DetailSlate.tsx`** — top bar with `dot`, "FOCUS · REFERENCE {n+1} / {total}", `timestamp+shot_id`, then `← PREV` / `NEXT →` / `ESC` rendered as `<Link>`s. Bounds-disabled links use `aria-disabled="true"` and a `.disabled` class (no href).

- **`DetailTopRow.tsx`** — verdict line ("● CONFIRMED · PAINTING · WIKIPEDIA VERIFIED · CONFIDENCE 0.92") + `<h1 className="serif-it">work_title <span className="by">— creator, year</span></h1>` + buttons NOT CONVINCED / JUMP. The "WIKIPEDIA ↗" external link present on the report card is intentionally **not** surfaced on the detail page top row (the mockup omits it). The wikipedia URL is implicit in the verdict line's "WIKIPEDIA VERIFIED" marker and the right-pane work metadata; users return to the grid for the explicit link.

- **`DetailCompare.tsx`** — 2 panes in a 1fr/1fr grid:
  - Left pane: `<img src="/api/frames/{youtubeId}/{frame_id}">` with `onError` hide-on-fail. Body: `lbl` line "From the clip · {tc} · {frame_id}", `ttl` title "Frame {n} — {composition snippet}" (composition truncated to 60 chars), `sub` "Camera {camera_move} · ..." truncated as in the mockup.
  - Right pane: `lbl` line "Reference work" (peach uppercase, mockup line 1373), `ttl` title (serif italic, the work title), `sub` "CREATOR · YEAR · MEDIUM · INSTITUTION" — fields joined with " · ", null fields skipped. Image: `<img src={wikipedia_thumbnail_url}>` if non-null, else `<div className="img-placeholder">Reference image · drop here</div>` styled with aged-paper background (subtle linear-gradient).

- **`DetailEvidence.tsx`** — 1.4fr/1fr grid:
  - Left: `<DetailReasoning>`:
    - Header (italic serif, muted) "EVIDENCE CHAIN · CROSS-REFERENCE → VERIFY" (mockup line 1382).
    - Pull-quote: the first sentence of `cross_ref_reasoning`, computed via the regex `/^.*?[.!?](?:\s|$)/` with a 240-char fallback cap (slice + ellipsis) if no terminator found. Rendered in serif italic with a 2px peach left-border, padding-left 16px.
    - Three labeled paragraphs: **Cross-reference pass** / **Adversarial pass** / **Wikipedia** rendering the full three fields.
  - Right: `<DetailFrameAnalysis>`:
    - Italic-serif header "Frame analysis" (mockup line 1407).
    - `<dl>` with rows: Composition, Palette, Camera, Costume / Setting, Distinctive features, Vision confidence.
    - Palette row: swatches from `palette_hex` followed by the descriptors from `palette` joined with " → " and uppercased (e.g. "MIDNIGHT → SODIUM"), mono font, muted color.
    - Vision confidence: `raw_confidence.toFixed(2)` (the report itself has no separate "final" verification confidence — display the raw value with a hairline note explaining it's pre-verify).
    - If `frame_analyses` does not contain the ref's `source_frame_id`, render a single hairline "Frame analysis unavailable" instead of the dl.

### `ReportContent.tsx` — new hash-based seek

The detail page's JUMP action returns the user to `/report/{id}#t={timestamp}`. The report page must read that hash on mount and seek the embedded player. No such handler exists today. Add to `ReportContent.tsx`:

```ts
useEffect(() => {
  if (typeof window === "undefined") return;
  const m = window.location.hash.match(/^#t=(\d+(?:\.\d+)?)$/);
  if (!m) return;
  const t = Number.parseFloat(m[1]);
  if (Number.isNaN(t)) return;
  // wait one frame for VideoPlayer to mount; then seek and clear the hash
  // so a later share/copy of the URL does not re-seek silently
  const timer = setTimeout(() => {
    playerRef.current?.seekTo(t);
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }, 0);
  return () => clearTimeout(timer);
}, [report]);
```

The `[report]` dep ensures we only seek once the report (and therefore the player) has rendered.

### `ReferenceCard.tsx` update

- The whole-card click opens the detail page. Implementation: wrap only the card's visual region (the `.ref-left` thumb + the title/verdict block) in a `<Link href={'/report/{id}/ref/{idx}'}>`. The `.ref-actions` row stays outside the Link so its existing `<a>` JUMP/WIKIPEDIA/NOT-CONVINCED elements are not nested inside another anchor (invalid HTML).
- The three `.ref-actions` anchors that exist today as `<a className="ulink">` with `onClick` handlers should be migrated to `<button className="ulink">` for the JUMP and NOT-CONVINCED handlers (they're not navigation); the WIKIPEDIA external link stays an `<a href target="_blank">`. This sidesteps the nested-anchor issue regardless of how the Link wraps.
- The `<article role="button" tabIndex={0} onKeyDown={handleKey} onClick={onJump}>` shell loses its role/tabIndex/keydown/onClick; the Link handles keyboard nav natively.
- `onJump` prop signature unchanged — still wired to the inline JUMP button (the inline player seek behavior). The whole-card click no longer triggers `onJump`; only the explicit button does.
- The "reasoning" string shown on the card is now `reference.cross_ref_reasoning` (one paragraph, the most defense-oriented of the three — closest to the previous concatenated reasoning).

### CSS additions (`frontend/app/globals.css`)

New section "SP4 — Reference detail" mirroring the mockup classes:
- `.detail` — root grid (auto auto auto, gap 24px, padding 32px 40px).
- `.detail-top` — flex baseline justify-between.
- `.detail-top h1` — serif italic 48px (`var(--serif)`).
- `.detail-compare` — `grid-template-columns: 1fr 1fr` with `min-width: 0` on each col.
- `.detail-pane` — surface-card bg + hairline border + `var(--r-2)` radius.
- `.detail-pane .img` — `aspect-ratio: 16/9`, black bg, `object-fit: cover`.
- `.detail-pane.placeholder .img` — aged-paper texture (subtle gradient).
- `.detail-evidence` — `grid-template-columns: 1.4fr 1fr` with `min-width: 0`.
- `.detail-reasoning` — surface-card box, padding, with `.pull-quote` (serif italic 19px, peach left-border 2px, padding-left 16px).
- `.detail-frame-analysis dl` — gap 14px, dt serif italic 13px muted, dd sans 13px ink.

All animations respect `prefers-reduced-motion: reduce`.

## Data flow

```
1. User on /report/{id}, sees grid of ReferenceCards (sorted by timestamp_s, mirroring the backend's stored order from §4).
2. Click card → `<Link>` to `/report/{id}/ref/{n}` (where `n` is the same index used when sorting the grid).
3. Server component fetches the report via `fetchReportServer(id)` (absolute URL); SSR returns HTML.
4. Page component validates n, hands `report` + `index` to `<ReferenceDetail>`.
5. `<ReferenceDetail>` renders. Keyboard listener mounted on `window`.
6. User hits ←/→ → `router.push('/report/{id}/ref/{n±1}')`.
7. ESC → `router.push('/report/{id}')`.
8. JUMP → `router.push('/report/{id}#t={timestamp}')`. The report page's new hash-seek `useEffect` (see Frontend §`ReportContent.tsx`) seeks the player and clears the hash.
9. NOT CONVINCED → existing `flagReference(youtubeId, idx)` → `POST /api/report/{id}/flag` (no new endpoint).
```

No new API endpoints. The orchestrator's enrichment step is invisible to the frontend except that the report payload now contains the new fields.

## Error handling

### Backend

| Failure | Behavior |
| --- | --- |
| Verifier: llama returns malformed JSON / missing fields | Pydantic ValidationError → ref dropped (existing behavior in `verify_all`) |
| WikidataEnricher: a single ref's HTTP call fails | Warn-logged, that ref returned with `medium/institution/inception_year = None`, others unaffected |
| WikidataEnricher: no `wikibase_item` for the page | Skip silently, fields stay None |
| WikidataEnricher: Wikidata returns the QID but no P186/P276/P571 claims | Corresponding fields stay None, the ones present are filled |
| WikidataEnricher: the whole step crashes | Orchestrator catches, logs, sets `enriched = verified`. Pipeline finishes with all enrichment fields null |
| `wikidata_enrichment=False` in settings | Orchestrator skips the call entirely, `enriched = verified` |

### Frontend

| Case | Behavior |
| --- | --- |
| `n` < 0 / NaN / ≥ length | `notFound()` → Next.js 404 page |
| Report 404 | `notFound()` → Next.js 404 page |
| Ref points to a hidden verdict | Render anyway. The page is filter-neutral |
| `frame_analyses` doesn't contain `source_frame_id` | DetailFrameAnalysis renders "Frame analysis unavailable" hairline |
| `/api/frames/{id}/{frame_id}` 404 | `onError` hides the img, the placeholder remains |
| `wikipedia_thumbnail_url` null | Aged-paper placeholder pane on the right |
| At edge (n=0 → PREV, n=last → NEXT) | Disabled `<Link>` (`aria-disabled`, `.disabled` class, no href) |
| Old report JSON in DB (pre-SP4 shape) | Pydantic ValidationError on read → /api/report/{id} returns 500 → /report/{id} shows the existing error UI. User reruns the analysis (intentional, per Out of scope). |

## Testing

### Backend

`backend/tests/unit/test_verifier.py` (existing — adapt)
- All tests that assert on `reasoning` must assert on the three new fields.
- New test: malformed JSON missing one of the three reasoning fields → ValidationError → ref dropped.

`backend/tests/unit/test_wikidata_enricher.py` (new)
- `test_enriches_with_medium_and_institution` — mock httpx to return a wikibase_item + claims for P186/P276/P571; assert ref comes back with all three fields filled.
- `test_no_wikibase_item` — pageprops without `wikibase_item`; ref returned with fields = None, no crash.
- `test_wikidata_returns_404_for_qid` — pageprops has QID but Wikidata EntityData returns 404; fields = None.
- `test_partial_claims_present` — entity has only P571 (inception), no P186/P276; only `inception_year` filled, others null.
- `test_one_ref_fails_others_succeed` — three refs in `enrich`; httpx throws for the second; first and third come back enriched, second has nulls.
- `test_skips_refs_without_wikipedia_url` — input ref with `wikipedia_url=None` passes through unchanged.

`backend/tests/unit/test_orchestrator.py` (existing — adapt)
- Mock the injected `enricher`. Assert the "Enriching with Wikidata" emit fires between `verify_all` and `done`.
- Test: enricher raises → orchestrator emits warning log, `verified` is used as-is, report saves successfully.

### Frontend

`frontend/components/report/detail/DetailReasoning.test.tsx` (new)
- Render with three non-null reasoning fields → three sections with the expected labels.
- Pull-quote shows first sentence of `cross_ref_reasoning`.

`frontend/components/report/detail/DetailCompare.test.tsx` (new)
- With `wikipedia_thumbnail_url` non-null → img element rendered.
- With null → placeholder element rendered.
- Right-pane sub line joins only the non-null metadata fields with " · ".

`frontend/components/report/detail/DetailNavigation.test.tsx` (new)
- `index=0` → PREV link has `aria-disabled="true"` and `.disabled` class, no href; NEXT is enabled.
- `index=total-1` → NEXT disabled, PREV enabled.
- Keyboard: simulate ArrowLeft/ArrowRight/Escape → mocked `router.push` called with the right path.

`frontend/components/report/ReportContent.test.tsx` (new) — for the hash-seek useEffect
- Initial `window.location.hash = "#t=42.5"` + mocked `playerRef.current.seekTo` → after mount, `seekTo(42.5)` called once, then `window.location.hash` is empty.
- Initial hash absent → `seekTo` not called.
- Malformed hash (`#t=abc`, `#foo`) → `seekTo` not called.

No test for the route file itself (server component, covered by TSC + manual e2e).

### Manual checklist

1. Run a fresh analysis → wait for `done` → open `/report/{id}` → ReferenceCards visible.
2. Click any ref card → URL `/report/{id}/ref/0` (or matching n) → DetailSlate at top, layout matches mockup.
3. Use `→` arrow key → URL increments, page rerenders with the next ref.
4. Use `←` from index 1 → URL `/ref/0`.
5. At `/ref/0` → PREV link visually disabled, no nav on click.
6. At last index → NEXT disabled.
7. Press `ESC` → URL back to `/report/{id}`.
8. Click "▸ JUMP TO" inside the detail page → returns to report, player seeks to the timestamp.
9. Click "NOT CONVINCED" → ref flagged (check DB row).
10. Open `/report/{id}/ref/9999` → Next.js 404 page.
11. Open `/report/{id}/ref/-1` → Next.js 404 page.
12. Open `/report/{id}/ref/0` directly (deep-link, no prior nav) → page renders SSR, no flash.
13. Check a hidden-verdict ref's URL — page renders the hidden ref's content.
14. Check that medium/institution/inception_year are filled for a famous work (Magritte, Picasso). Check a known obscure work — fields gracefully null.
15. Force `wikidata_enrichment=False` → rerun → all three new fields null in the report. DetailCompare right-pane sub-line still renders (creator/year only, no " · MEDIUM" suffix).
16. Open the page with reduced-motion → animations static.
