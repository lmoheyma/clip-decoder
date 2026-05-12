# Design System Migration — Sub-project 2: Report enriched

> Second sub-project of the 5-sub-project design refactor (`index.html` + `styles.css` at repo root). SP1 (landing reskin) is merged. SP2 reskins the report page **and** adds Tier-2 enrichment features that the new design exposes (hidden refs visible, frame thumbnails per card, hex palette swatches, Wikipedia thumbnails, summary card, multi-axes filter chips).
>
> Tier-3 features (Re-run, Export, custom scrubber, stage timings, NIM credits, separate Run ID, Sort dropdown, Restore-to-speculative) are explicitly deferred.

## Goal

Migrate `/report/{id}` from the legacy "tech-forward" visual register (light/midnight mix, magenta/orange voltage, Bricolage + IBM Plex) to the new editorial register established in SP1 (dark canvas + EB Garamond + Inter + pastel ambient orbs), **and** enrich the report with new content that the design fixture surfaces:

- Per-card frame thumbnail (served from the keyframe jpegs already on disk)
- Per-card hex palette swatches (extracted backend-side via PIL + KMeans)
- Hidden references visible (with rejected styling, default off via filter chip)
- Wikipedia thumbnail mini-badge next to each ref title
- Summary card with verdict breakdown + sources span ("1929 → 2000 · 8 films · 4 paintings ·…")
- Multi-axes filter chips (verdict + work_type) replacing the binary `ConfidenceFilter`
- Slate top bar (consistent with SP1 landing)
- Footer with derivable run metadata (run id, Wikipedia hits ratio, reference breakdown)

## Non-goals

- Custom scrubber with colored verdict markers — deferred to SP3 (Pipeline live page) or a future polish SP.
- Pipeline stage timings instrumentation + display — deferred (no per-stage timing infra in current backend).
- Re-run button (DELETE + restart pipeline) — deferred.
- Export button (JSON/PDF download) — deferred.
- Restore-to-speculative action (un-flag) — deferred to keep parity with Re-run/Export omission.
- NIM credits tracking — deferred (no infra).
- Separate Run ID UUID distinct from youtube_id — deferred.
- Sort dropdown beyond default `timecode ASC` — deferred.
- Reference detail page → SP4.
- Error page polish + cookies retry → SP5.

## Decisions matrix

| Decision | Choice | Rationale |
|---|---|---|
| SP2 feature tier | C: reskin + Tier 1 + Tier 2 | A is too thin (cards without thumb/palette feel hollow); D adds heavy scrubber+timing instrumentation for marginal gain |
| Palette hex extraction | Backend via PIL + KMeans (5 clusters) | Deterministic, fast, runs once at frame extraction; descriptors preserved as flavor label |
| Wikipedia thumbnail | Backend stores URL (single API call in verifier) + frontend displays as mini-badge | Verifier already calls `/page/summary`; field is in same JSON response |
| Header h1 | Hybrid: decorative `<h1>A clip you'd like decoded.</h1>` + serif subtitle `report.title` + meta line | Preserves editorial copy AND surfaces the actual video title |
| Filter chips | Multi-axes toggle (3 verdict + N work_types, AND between groups, OR within) | Replaces `ConfidenceFilter` binary; uniform affordance on all chips |
| Hidden refs default visibility | Filter chip OFF by default (Confirmed + Speculative ON) | Report feels clean on arrival; user can opt-in via chip |
| Tier-3 button placeholders | Selective: Raw JSON + Share implemented; Re-run + Export omitted | Raw JSON and Share are 5 lines each; Re-run and Export are real backend work that deserves its own sub-project |

## Architecture

### Files modified

#### `backend/app/models.py` (additive)

```python
# In FrameAnalysis
palette_hex: list[str] = []  # NEW: 5 hex codes like ["#1c1c1c", "#3a4a6b", ...]

# In VerifiedReference
wikipedia_thumbnail_url: str | None = None  # NEW
```

**Note on `created_at`:** `AnalysisRow` in `backend/app/db.py` (line 35) **already** has a `created_at` column that records when the run row was first written. We do NOT add `created_at` to the Pydantic `Report` model (would duplicate state and risk drift with the persisted JSON blob).

Instead, the `/api/report/{youtube_id}` endpoint reads the row's `created_at` and injects it into the response payload. The current endpoint returns just `report_json` (line ~123 of `db.py`); we extend the route handler in `backend/app/api/routes.py` to merge in the row's `created_at` (e.g., `{**report.model_dump(), "created_at": row.created_at.isoformat()}`). Frontend types receive `created_at: string` (ISO 8601). This keeps the DB row the single source of truth and avoids a Pydantic + Pydantic-JSON double-write.

Defaults (`[]`, `None`) on Pydantic make old persisted runs load gracefully — frontend will detect empty `palette_hex` and `None` thumbnails and render skipping.

**No alembic migration needed.** `report_json` is a `JSON` column in `AnalysisRow` (db.py line 33). Adding fields to the Pydantic models simply changes the shape of the JSON blob; old rows still deserialize because Pydantic applies the new defaults at load time.

#### `backend/app/pipeline/palette.py` (NEW — ~30 lines)

```python
from pathlib import Path
from PIL import Image
import numpy as np
from sklearn.cluster import KMeans

_N_CLUSTERS = 5
_SAMPLE_SIZE = 100  # downscale 100x100 before clustering — fast, stable

def extract_palette_hex(frame_path: Path) -> list[str]:
    """Return 5 dominant colors as hex strings, ordered by cluster size desc."""
    img = Image.open(frame_path).convert("RGB")
    img.thumbnail((_SAMPLE_SIZE, _SAMPLE_SIZE))
    pixels = np.array(img).reshape(-1, 3)
    km = KMeans(n_clusters=_N_CLUSTERS, n_init=4, random_state=42).fit(pixels)
    centers = km.cluster_centers_.astype(int)
    counts = np.bincount(km.labels_, minlength=_N_CLUSTERS)
    order = np.argsort(-counts)
    return [_rgb_to_hex(centers[i]) for i in order]

def _rgb_to_hex(rgb) -> str:
    return "#" + "".join(f"{c:02x}" for c in rgb)
```

Dependencies (verified absent from `backend/pyproject.toml` — all three are NEW additions in SP2):
- `Pillow` (image decode/downsample) — **add explicitly**, NOT currently a backend dependency. `shot_sampler.py` uses `ffmpeg`, not PIL.
- `numpy` (pixel arrays) — **add explicitly**. Transitively present via `scenedetect[opencv]` but should not rely on transitive deps.
- `scikit-learn` (KMeans clustering) — **add explicitly**.

Add to `[project.dependencies]` in `pyproject.toml`:
```toml
"Pillow>=10.0",
"numpy>=1.26",
"scikit-learn>=1.4",
```
Docker layer rebuild required after the change (~30s for the install layer cache miss).

Tests (`backend/tests/unit/test_palette.py`):
1. `test_extract_palette_returns_5_hex_strings` — fixture JPG → asserts `len == 5` and each entry matches `^#[0-9a-f]{6}$`
2. `test_extract_palette_deterministic` — same input twice → same output (random_state=42)
3. `test_extract_palette_solid_color` — synthetic all-red image → all 5 hex within tolerance of `#ff0000`

#### `backend/app/pipeline/frame_analyzer.py` (modify — NOT shot_sampler.py)

`FrameAnalysis` is constructed in `frame_analyzer.py:35` inside `_one(keyframe)`. `shot_sampler.py` produces `KeyFrame` only — it has no knowledge of `FrameAnalysis`. The palette extraction must hook into `frame_analyzer._one`:

```python
# In FrameAnalyzer._one(), after building the FrameAnalysis fields and before return:
from app.pipeline.palette import extract_palette_hex
palette_hex = extract_palette_hex(kf.frame_path)
return FrameAnalysis(
    ...existing fields...,
    palette_hex=palette_hex,
)
```

~3 lines added (import + call + field assignment). The keyframe file is already on disk at the point `_one` is called (shot_sampler wrote it), so no ordering issue.

#### `backend/app/pipeline/verifier.py` (modify)

When parsing the Wikipedia `/page/summary/{title}` response, also extract `data.get("thumbnail", {}).get("source")` and assign to `VerifiedReference.wikipedia_thumbnail_url`. ~3 lines added.

Tests (extend existing `test_verifier.py`):
1. `test_wikipedia_thumb_parsed_when_present` — mock response with `thumbnail.source` → field populated
2. `test_wikipedia_thumb_none_when_absent` — mock response without `thumbnail` → field stays `None`

#### `backend/app/api/routes.py` (frame serving endpoint)

Add a new route handler. The router is declared with `APIRouter(prefix="/api")` (routes.py:38), so the decorator path uses just `/frames/...` (the `/api` prefix is applied automatically by FastAPI).

The frames directory base path comes from `app.settings` (the codebase convention; see how other paths are constructed). At time of writing the run output root is configured in `settings`; verify the actual attribute name at implementation time (likely `settings.runs_dir` or similar).

```python
import re
from fastapi import HTTPException
from fastapi.responses import FileResponse
from app.settings import settings  # whichever import the rest of routes.py uses

_YOUTUBE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")
_FRAME_ID_RE = re.compile(r"^shot_\d+$")

@router.get("/frames/{youtube_id}/{frame_id}")
def get_frame(youtube_id: str, frame_id: str):
    if not _YOUTUBE_ID_RE.fullmatch(youtube_id):
        raise HTTPException(400, "invalid youtube_id format")
    if not _FRAME_ID_RE.fullmatch(frame_id):
        raise HTTPException(400, "invalid frame_id format")
    path = settings.runs_dir / youtube_id / "frames" / f"{frame_id}.jpg"
    if not path.exists():
        raise HTTPException(404, "frame not found")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
```

External URL after FastAPI assembles the prefix: `GET /api/frames/{youtube_id}/{frame_id}`. Frontend uses this path.

Also extend the existing `GET /api/report/{youtube_id}` handler to merge in `row.created_at`:

```python
@router.get("/report/{youtube_id}")
async def get_report(youtube_id: str):
    row = await db.get_row(youtube_id)        # whatever the existing call is
    if not row or not row.report_json:
        raise HTTPException(404, "report not found")
    report = Report.model_validate(row.report_json)
    return {**report.model_dump(), "created_at": row.created_at.isoformat()}
```

(The exact shape depends on what the current handler returns; the key change is adding `created_at` from the row to the response.)

Tests (`backend/tests/integration/test_frames_endpoint.py`):
1. `test_get_frame_returns_200_with_correct_mime` — fixture frame on disk → 200 + content-type image/jpeg
2. `test_get_frame_404_on_missing` — absent file → 404
3. `test_get_frame_400_on_invalid_frame_id` — `frame_id="../config"` → 400 (path traversal blocked)

#### Frontend

##### `frontend/lib/types.ts` (modify)

Add `palette_hex?: string[]`, `wikipedia_thumbnail_url?: string | null`, `created_at?: string` to the relevant types.

##### `frontend/app/report/[id]/page.tsx` (rewrite — ~219 → ~280 lines)

Layout (inside `<main className="frame surface-dark relative min-h-screen flex flex-col">`):

```
Slate                ← top bar
Header               ← decorative h1 + serif report.title + meta + Share/Raw JSON
PlayerRow            ← VideoPlayer left + SummaryCard right (lg:grid-cols-[1.6fr_1fr])
FilterBar            ← chips (verdict + work_type, AND between groups)
ReferenceGrid        ← filteredReferences.map(<ReferenceCard/>)
Footer               ← Run · {youtube_id} · Wikipedia hits · breakdown
```

Loading state (`!report && !error`) shows a reskinned `PipelineStatus` (same logic, primitive classes from SP1).

Error state shows serif title + hairline body + link to landing.

State at this level: `report`, `events`, `error`, `selectedVerdicts: Set<Confidence>`, `selectedTypes: Set<string>`. Default `selectedVerdicts = new Set(["confirmed", "speculative"])`, `selectedTypes = new Set(derivedTypesFromReport)`.

Derived data (memoized in `ReportPage` via `useMemo`):
- `stats` — `{confirmed, speculative, hidden, shots, duration, wikiHits, minYear, maxYear, typeBreakdown}`
- `availableTypes` — `Array.from(new Set(report.references.map(r => r.work_type)))`
- `filteredReferences` — refs included if and only if **(a)** their `final_confidence` ∈ `selectedVerdicts` AND **(b)** their `work_type` ∈ `selectedTypes`. Filtering is AND between the two axes (verdict and type), OR within each axis (union of selected verdict states; union of selected work_types). Sorted by `timestamp_s` ascending.
- `enrichedReferences` — each ref joined with its source `FrameAnalysis` for `palette_hex` + `palette` (descriptors).

**Recommendation**: extract `stats` derivation into `frontend/lib/reportStats.ts` (pure function `computeReportStats(report) -> Stats`) so it's independently testable and `ReportPage` stays focused on view assembly. Add `frontend/lib/reportStats.test.ts` with 3-4 tests covering empty refs, no years, mixed verdicts.

##### `frontend/components/ReferenceCard.tsx` (rewrite — ~121 → ~190 lines)

Two-column card (left: thumb + palette, right: verdict + title + meta + reasoning + chips + confidence + actions). Props:

```tsx
interface ReferenceCardProps {
  reference: VerifiedReference;
  paletteHex: string[];                    // derived from FrameAnalysis lookup
  paletteDescriptors: string[];            // derived from FrameAnalysis lookup
  youtubeId: string;
  onJump: () => void;
  onFlag: () => void;
}
```

Card uses `<article role="button" tabIndex={0}>` for full-card click → seek. Internal links (Wikipedia, Jump, Not convinced) `stopPropagation` to avoid double-firing.

Markup details:
- Thumb: `<div className="thumb" style={{ backgroundImage: \`url(/api/frames/${youtubeId}/${ref.source_frame_id}.jpg)\`, filter: hiddenFilter }}><span className="tc-overlay">{formatTimecode} · {ref.source_frame_id.toUpperCase()}</span></div>`
- Palette: 5 swatches (`<span style={{ background: hex }}/>`) + hairline label `PALETTE · {descriptors.join(" → ").toUpperCase()}` (skipped if `paletteHex.length === 0`)
- Verdict line: `<span className="verdict-marker verdict-{class}">{icon} {LABEL}</span> · {work_type} · Wikipedia verified` (last token only if `wikipedia_url`)
- Title row: `<h3 className="serif-it ref-title"><em>{work_title}</em></h3>` + optional `<img className="wiki-thumb" src={wikipedia_thumbnail_url} alt="" loading="lazy" onError={hide}/>` 60×60 next to title
- Meta: `{work_creator} · {work_year ?? "—"} · {work_type}`
- Reasoning: `<p className="ref-reasoning">{reasoning}</p>`
- Evidence chips: `<div className="ev"><span className="chip {chip-cyan|chip-dim per verdict}">{el}</span>...</div>`
- Confidence bar: `<div className="conf {conf-cyan|conf-rose per verdict}"><span>CONFIDENCE</span><span className="bar"><i style={{width:percent}}/></span><span>{raw_confidence.toFixed(2)}</span></div>`
- Actions: `▸ JUMP TO {time}` (always), `WIKIPEDIA ↗` (if url), `NOT CONVINCED ✕` (if not hidden)
- Hidden styling: title has `text-decoration: line-through; text-decoration-color: var(--error)`, thumb gets `filter: grayscale(0.7) brightness(0.6)`, palette opacity 0.4

##### `frontend/components/FilterBar.tsx` (NEW)

```tsx
interface FilterBarProps {
  counts: { verdicts: Record<Confidence, number>; types: Record<string, number> };
  availableTypes: string[];
  selectedVerdicts: Set<Confidence>;
  selectedTypes: Set<string>;
  onToggleVerdict: (v: Confidence) => void;
  onToggleType: (t: string) => void;
}
```

Renders 3 verdict chips + divider + N work_type chips. Each chip is a `<button type="button">` with `chip chip-{class} {chip-on|chip-off}` className. Visual: `chip-off` = grayscale + opacity 0.5; `chip-on` = colored.

Right side: static label "Sort · timecode ↑" (sort by other fields is Tier-3).

Tests (`frontend/components/FilterBar.test.tsx` — NEW, 3 tests):
1. `toggle_verdict_chip_updates_state` — render with selection, click "Hidden", assert callback fires
2. `default_state_excludes_hidden` — render with `Set(["confirmed","speculative"])`, assert hidden chip has `chip-off` class
3. `type_filter_groups_independently` — toggle a type, verdict chips unchanged (independent state)

##### `frontend/components/SummaryCard.tsx` (NEW)

```tsx
interface SummaryCardProps {
  total: number;
  shots: number;
  confirmed: number;
  speculative: number;
  hidden: number;
  minYear: number | null;
  maxYear: number | null;
  typeBreakdown: Array<{ type: string; count: number }>;
}
```

Renders the right column of the player-row: hairline "References found" + big `<em>` total + small "across N shots" + 3-row breakdown (Confirmed/Speculative/Hidden with colored swatches) + hairline "Sources span minYear → maxYear · 8 films · 4 paintings ·…".

If `minYear` and `maxYear` null (no refs with year), hide the sources line.

##### `frontend/components/ConfidenceFilter.tsx` (DELETE)

Replaced by `FilterBar.tsx`.

##### `frontend/components/ReferencePanel.tsx` (simplify or delete)

Was the filtering+grid container. Now redundant: `ReportPage` directly maps `filteredReferences` into `<ReferenceCard/>`. Delete the component.

##### `frontend/components/ReferencePanel.test.tsx` (DELETE)

Logic moved to `FilterBar.test.tsx` (state) + `ReportPage` (integration).

##### `frontend/components/PipelineStatus.tsx` (minor reskin)

Replace tech-forward styling with primitive classes (`.uc`, `.hairline`, `.serif-it`, `.surface-dark`). No structural change. Existing tests should pass.

##### `frontend/components/VideoPlayer.tsx` (unchanged)

Mechanics intact. May wrap in a `.player` div for new styling.

##### `frontend/app/globals.css` (additive — append new report-specific block)

New classes to add (before the legacy `.bg-pastel-cloud` block, alongside existing SP1 classes):

- `.player-row` — grid 2 columns on `lg`, single column mobile
- `.player` — wrapper for iframe with `border-radius: var(--r-2)`, `overflow: hidden`
- `.summary-card` — aside styling with hairline labels + serif number + breakdown rows
- `.summary-card .num` — display: flex; em is `var(--serif)` `font-size: clamp(56px, 6vw, 88px)`
- `.summary-card .breakdown` — vertical stack of rows with swatch + label + count
- `.summary-card .swatch` — 10×10 rounded dot
- `.timeline-bar` / `.filter-bar` — flex row, wrapping, with hairline border-bottom
- `.filter-bar .left` / `.right` — flex containers
- `.filter-bar .filter-divider` — `1px × 18px` vertical line in hairline color
- `.chip-on` / `.chip-off` — opacity + color states for filter chips
- `.grid` — `display: grid; grid-template-columns: repeat(auto-fit, minmax(min(640px, 100%), 1fr)); gap: 24px`
- `.ref` — base card; grid 2 columns (`.ref-left` 1fr + `.ref-right` 1.4fr), gap 24px, padding 24px, background `var(--surface-card)`, border hairline, border-radius `var(--r-2)`, position relative, cursor pointer, transition border-color 0.18s
- `.ref:hover` — border-color `var(--hairline-strong)`
- `.ref-confirmed` — accent border-left `2px solid var(--grad-peach)` (subtle)
- `.ref-speculative` — accent border-left `2px solid var(--grad-sky)`, opacity 0.95
- `.ref-hidden` — accent border-left `2px solid var(--error)`, opacity 0.7
- `.thumb` — `aspect-ratio: 16/9`, background-size: cover, background-position: center, border-radius `var(--r-1)`, position relative, background-color `var(--surface-strong)` (fallback)
- `.tc-overlay` — absolute bottom-left, padding 4px 8px, background rgba(0,0,0,0.6), `font-family: var(--sans)`, uppercase 11px, color var(--ink), letter-spacing 0.96px
- `.palette` — flex row, gap 4px, height 24px
- `.palette span` — flex: 1, height: 100%, border-radius 4px
- `.palette-label` — hairline mini label
- `.ref-verdict-line` — flex row, gap 10px, hairline-style
- `.verdict-marker.verdict-confirmed` — color `var(--grad-peach)`
- `.verdict-marker.verdict-speculative` — color `var(--grad-sky)`
- `.verdict-marker.verdict-hidden` — color `var(--error)`
- `.ref-title-row` — flex row, justify-between, align-start
- `.ref-title em` — italic, no decoration unless hidden (where title-row has line-through via parent class)
- `.ref-title-rejected` — `text-decoration: line-through; text-decoration-color: var(--error); text-decoration-thickness: 1px`
- `.wiki-thumb` — 60×60 square, border-radius `var(--r-1)`, object-fit: cover, opacity 0.85
- `.wiki-thumb:hover` — opacity 1
- `.ref-meta` — uppercase, sans, 11px, muted, letter-spacing 0.96px
- `.ref-reasoning` — body color, 14px, line-height 1.5, max-width 60ch
- `.ev` — flex row, wrap, gap 6px
- `.conf` — flex row, gap 12px, uppercase, sans, 11px
- `.conf .bar` — flex: 1, height 2px, background `var(--hairline)`, border-radius pill, overflow hidden
- `.conf .bar i` — display block, height 100%, background `var(--grad-peach)` by default
- `.conf-cyan .bar i` — background `var(--grad-sky)`
- `.conf-rose .bar i` — background `var(--error)`
- `.ref-actions` — flex row, gap 14px, margin-top 14px
- `.ulink` — color `var(--ink)`, text-decoration none, border-bottom 1px solid `var(--hairline-strong)`, padding-bottom 2px, cursor pointer
- `.ulink:hover` — border-bottom-color `var(--ink)`
- `.ulink-muted` — color `var(--muted)`
- `.report-header` — flex row justify-between, padding clamp(32px, 5vw, 64px), gap 24px
- `.report-h1` — clamp(56px, 7vw, 96px), serif-it, line-height 0.96, color `var(--ink)`
- `.report-title` — clamp(28px, 3vw, 40px), serif-it, color `var(--body-strong)`, margin-top 20px
- `.report-meta` — hairline-style, flex row, gap 8px, wrap
- `.report-footer` — flex row justify-between, padding 24px 64px, border-top hairline, font sans 12px uppercase letter-spacing 0.96px color muted, gap 24px, wrap

Mobile rules (`@media (max-width: 768px)`):
- `.player-row` → `grid-template-columns: 1fr`
- `.ref` → `grid-template-columns: 1fr`
- `.report-header` → `flex-direction: column`
- `.filter-bar` → `flex-direction: column`
- `.grid` → `grid-template-columns: 1fr`

##### `frontend/app/globals.css` slate (add for report context)

Extend existing slate mobile rules to include `.slate-context` hide at `<640px`. Add `.slate-action` style (button-link with `.ulink`-like styling but in slate height).

#### Tier-3 trivial features (implemented in SP2 per decision matrix)

**Share button** (~5 lines in `Slate` component):
```tsx
async function shareLink() {
  try { await navigator.clipboard.writeText(window.location.href); }
  catch { /* fallback or toast unavailable */ }
  setShareToast(true);
  setTimeout(() => setShareToast(false), 2000);
}
```

**Raw JSON link** (~1 line): `<a href={\`/api/report/${id}\`} target="_blank" rel="noopener">Raw JSON</a>` — uses the existing `GET /api/report/{youtube_id}` endpoint (the one extended above to include `created_at`). FastAPI returns JSON content-type by default for dict responses; the browser will pretty-print or download depending on the user's configuration. No file-extension suffix needed.

### Files unchanged

- All landing files (`app/page.tsx`, `components/HeroForm.tsx`, etc.) from SP1.
- `tailwind.config.ts` — still keeps legacy tokens until the loading state and any remaining legacy reference is cleaned in a future SP.
- `index.html`, `styles.css` at repo root — authoring reference, untracked, kept.

### Files at repo root (untracked, kept as reference)

- `index.html` lines 905–1322 — report mockup, the authoring fixture for this sub-project.
- `styles.css` — design system CSS reference.

## Component / data flow

```
ReportPage
├── fetchReport(id) → Report (with FrameAnalysis[] including palette_hex, VerifiedReference[] including wikipedia_thumbnail_url)
├── subscribePipeline(id, onEvent) → PipelineEvent[] (loading state only)
├── useState: selectedVerdicts, selectedTypes
├── useMemo: stats, availableTypes, frameById, enrichedRefs, filteredRefs
├── playerRef → VideoPlayer
└── render:
    ├── Slate (with shareToClipboard handler + Raw JSON link)
    ├── Header (h1 decorative + serif title + meta line)
    ├── PlayerRow
    │   ├── VideoPlayer (ref-bound)
    │   └── SummaryCard (stats)
    ├── FilterBar (counts, selectedVerdicts, selectedTypes, callbacks)
    ├── div.grid > ReferenceCard × N (filteredRefs)
    └── Footer (run id + wiki hits + breakdown)
```

No new data flow patterns. All filtering/sorting is client-side memoized derivation. The only new network calls are:
1. `<img>` requests to `/api/frames/{youtube_id}/{frame_id}` (browser auto, lazy-load on scroll)
2. `<img>` requests to Wikipedia thumb URLs (cross-origin, CORS-public)

## Error handling

- **Frame thumb 404**: browser fails silently; thumb shows the `--surface-strong` background. Optional `:empty::before` pseudo with "frame unavailable" label.
- **Wikipedia thumb URL stale or 404**: `<img onError>` removes the element.
- **Empty references**: full-page hairline + serif title "No quotations identified" + retry link.
- **All references filtered out**: in-grid hairline "All references filtered out. Re-enable a chip above."
- **Pipeline error (existing flow)**: reskinned error card with serif title, body message, link to landing.
- **Share clipboard unavailable**: toast "Browser does not support clipboard, copy manually." Or silent fallback if HTTPS dev.

## Testing strategy

**Backend**

- `backend/tests/unit/test_palette.py` (NEW) — 3 tests
- `backend/tests/unit/test_verifier.py` (EXTEND) — 2 tests for thumbnail parsing
- `backend/tests/integration/test_frames_endpoint.py` (NEW) — 3 tests

**Frontend**

- `frontend/components/FilterBar.test.tsx` (NEW) — 3 tests
- `frontend/lib/reportStats.test.ts` (NEW) — 3-4 tests for stats derivation (empty refs, no years, mixed verdicts, type breakdown)
- `frontend/components/ReferencePanel.test.tsx` (DELETE) — component goes away
- `frontend/components/HeroForm.test.tsx`, `VideoPlayer.test.tsx`, `PipelineStatus.test.tsx` — unchanged (still pass)

No new tests for `ReferenceCard` (visual reskin, no testable logic), `SummaryCard` (consumes Stats input — covered by `reportStats.test.ts`), or `ReportPage` (integration covered by manual verification).

**Net test delta:** backend +8 (3 palette, 2 verifier extension, 3 frames endpoint); frontend +6 -4 = +2 (3 FilterBar new, 3-4 reportStats new, 4 ReferencePanel removed).

**Manual verification** (final task in plan):

1. Submit a YouTube URL on landing → redirect → loading state visible (reskinned) → SSE events → done → report renders.
2. Slate visible: dot peach→rose, youtube_id, duration, counts, Share button works (URL copied to clipboard), Raw JSON link opens new tab.
3. Header h1 decorative + serif subtitle = real title + meta line with channel, duration, shots, "Analysed {date}", "Wikipedia verified" (conditional).
4. Player-row: video plays; click any card → seeks; summary-card shows counts + sources span + type breakdown.
5. Filter bar: 3 verdict chips + N work_type chips; default Hidden off; click Hidden → hidden refs appear with line-through title + grayscale thumb; click a work_type chip → cards of that type disappear.
6. Cards: thumb loads from `/api/frames/...`; palette 5 hex swatches visible; palette descriptors hairline label; verdict marker color matches; serif italic title; Wikipedia mini-badge 60×60 if available; reasoning, evidence chips, confidence bar; actions Jump / Wikipedia / Not convinced (or Restore omitted for hidden).
7. "Not convinced" → ref disappears from default view (flag flow still works, ref moves to Hidden verdict).
8. Footer: run id, Wikipedia hits N/total, reference breakdown.
9. Mobile (≤640px): slate compacts; grid → 1 column; player-row stacks; filter-bar wraps.
10. `prefers-reduced-motion`: orbs static (inherited from SP1 rule).

## Edge cases

1. **Old runs missing `palette_hex` / `wikipedia_thumbnail_url` / `created_at`** — Pydantic defaults make load succeed. Frontend hides palette block on `palette_hex.length === 0`. Hides wiki thumb on `null`. Falls back to "Analysed recently" on missing date.

2. **Frame jpg missing on disk** — endpoint returns 404. `<img>` background fails silently. Thumb shows surface-strong fallback color.

3. **Empty references list** — render full-page hairline "No quotations identified" + retry link.

4. **All chips deselected by user** — grid shows "All references filtered out. Re-enable a chip above."

5. **`work_year` null** — meta line shows "—" placeholder.

6. **Wikipedia thumb 404 at render** — `<img onError>` removes element from DOM.

7. **Loading state during SSE streaming** — `PipelineStatus.tsx` reskinned to dark canvas + serif/hairline primitives. Logic unchanged.

8. **Pipeline error** — error card reskinned: serif title + body color + link back. No new states.

9. **`navigator.clipboard.writeText` unavailable** — try/catch + console.warn + toast. Button remains active.

10. **Path traversal on frames endpoint** — blocked by regex on both `youtube_id` (`^[a-zA-Z0-9_-]{11}$`) and `frame_id` (`^shot_\d+$`). Tested.

11. **scikit-learn missing in pyproject.toml** — verify at Task 1; add if absent; Docker rebuild required (~30s layer).

12. **DB migration for new columns** — NOT NEEDED. `AnalysisRow.report_json` is a `JSON` column (`backend/app/db.py:33`). Pydantic-Report fields land in the blob; old rows deserialize via Pydantic defaults at load time. No alembic work.

13. **Mobile viewport** — all responsive rules verified in manual checklist Step 9.

14. **Reduced motion** — orbs respect `prefers-reduced-motion` (inherited from SP1).

## Done criteria

SP2 is complete when:

- ✅ `backend/app/models.py` extended with `FrameAnalysis.palette_hex: list[str] = []` and `VerifiedReference.wikipedia_thumbnail_url: str | None = None`. NOT modified: `Report` (created_at stays on `AnalysisRow`, merged into endpoint response).
- ✅ `backend/pyproject.toml` updated with `Pillow>=10.0`, `numpy>=1.26`, `scikit-learn>=1.4`; Docker layer rebuild verified.
- ✅ `backend/app/pipeline/palette.py` created with `extract_palette_hex()` + 3 passing tests.
- ✅ `backend/app/pipeline/frame_analyzer.py` (NOT shot_sampler.py) calls `extract_palette_hex(kf.frame_path)` in `_one()` and assigns to `FrameAnalysis.palette_hex`.
- ✅ `backend/app/pipeline/verifier.py` parses Wikipedia thumbnail URL; `VerifiedReference.wikipedia_thumbnail_url` populated; +2 tests.
- ✅ `GET /api/frames/{youtube_id}/{frame_id}` endpoint live (registered as `@router.get("/frames/...")` since router has `prefix="/api"`), uses `settings.runs_dir` for base path, regex validation on both path params, Cache-Control immutable, 3 passing tests.
- ✅ `GET /api/report/{youtube_id}` handler extended to merge `row.created_at` into the JSON response.
- ✅ `frontend/app/report/[id]/page.tsx` rewritten: Slate, Header, PlayerRow, FilterBar, ReferenceGrid, Footer.
- ✅ `frontend/components/ReferenceCard.tsx` rewritten per spec markup.
- ✅ `frontend/components/FilterBar.tsx` created + 3 passing tests.
- ✅ `frontend/components/SummaryCard.tsx` created.
- ✅ `frontend/components/ConfidenceFilter.tsx` deleted.
- ✅ `frontend/components/ReferencePanel.tsx` and `ReferencePanel.test.tsx` deleted.
- ✅ `frontend/components/PipelineStatus.tsx` reskinned (primitives, no structural change).
- ✅ `frontend/app/globals.css` augmented with all report-specific classes listed above.
- ✅ `frontend/lib/types.ts` reflects new backend fields.
- ✅ Tier-3 trivial features: Share button (clipboard) + Raw JSON link both work.
- ✅ All backend tests pass (existing + new palette/verifier/frames).
- ✅ All frontend tests pass (existing - ReferencePanel + new FilterBar = net +3 - 4 = net -1 test, all green).
- ✅ Manual verification checklist (above) passes end-to-end.
- ✅ Mobile viewport (≤640px) verified.
- ✅ Reduced-motion check verified.
- ✅ Branch `feature/design-system-sp2` merged into `main` after final review.

## Risks

- **scikit-learn install** — if absent from `pyproject.toml`, Docker layer rebuild required (~30s). Low risk, easy fix.
- **DB schema migration** — if FrameAnalysis/VerifiedReference are persisted in structured columns (not a JSON blob), alembic migration needed. Detection deferred to Task 1; mitigation: add a migration task if discovered.
- **Frame jpg cleanup race** — if a future Re-run deletes frames mid-render, browser sees 404 on subsequent loads. Acceptable; SP-polish can add stale-content invalidation.
- **Wikipedia thumb URL stale** — refs cached in DB may have URLs that 404 after Wikipedia file renames. Mitigation: `onError` hides the thumb. Re-run regenerates fresh URLs.
- **Large PR scope** — SP2 touches ~10 frontend files + ~4 backend files. Mitigated by fine task decomposition in the implementation plan (12-15 tasks expected).
- **Loading-state visual mismatch** — if the minimal reskin of `PipelineStatus` feels jarring against the new dark report, SP3 (Pipeline live page) can fully replace it.

## Out of scope

- Backend: stage-timings tracking, NIM credits, separate Run ID UUID, re-run pipeline, restore-to-speculative endpoint.
- Frontend: custom scrubber with markers, Re-run button, Export button, Restore-to-speculative link, Sort dropdown beyond timecode, fully rewritten loading state, error page polish, reference detail page.
- Migration cleanup: dropping the legacy `--color-midnight`/`--color-magenta`/etc. tokens and legacy classes (`.bg-deep-sky`, `.text-aurora`, `.marquee`, etc.) — kept until a final SP-cleanup once PipelineStatus and any other legacy consumers are migrated.
