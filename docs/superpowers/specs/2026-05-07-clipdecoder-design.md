# ClipDecoder — Design Spec

**Date:** 2026-05-07
**Status:** Draft (awaiting user review)
**Author:** Louis

## 1. Goal

ClipDecoder is a local-first tool that decodes the *visual references* hidden in a YouTube music video — citations of films, paintings, photographs, recurring motifs, and stylistic homages. The target user is a curious listener who wants to understand what their eye is missing.

The output is an annotated viewer: video on the left, a panel of identified references on the right, each one anchored to a timestamp and a frame from the clip, with explicit confidence levels and the reasoning behind the claim. The user can click a reference to jump the video and inspect the cited work side by side.

The project is open-source, runs entirely on a developer's machine via `docker compose up`, and uses NVIDIA NIM free-tier endpoints (Cosmos Reason for vision, Llama/Nemotron for cultural cross-referencing) with the user's own `nvapi-` key.

## 2. Non-Goals (v1)

Explicitly out of scope:

- Multi-clip aggregation per artist (no "visual signature of Beyoncé" view)
- Cross-clip recommendation ("clips that share references with this one")
- Local file upload (URL only)
- Platforms other than YouTube
- Auth, user accounts, public sharing of reports
- Hosted public demo (each user runs locally with their own key)

## 3. User Flow

1. User clones the repo, copies `.env.example` to `.env`, fills `NVAPI_KEY=nvapi-...`, runs `docker compose up`.
2. Opens `http://localhost:3000`. Lands on a hero page (light, pastel gradient background) with a single input: paste a YouTube URL.
3. Clicks **Decode**. A status section appears below the form, streaming pipeline steps via SSE: "Downloading clip → Detecting shots (12 found) → Analyzing frame 5 of 12 → Cross-referencing → Verifying → Done."
4. On completion, redirects to `/report/<youtube_id>`. The report page is dark-mode (midnight blue `#010120`, "research zone" aesthetic). Layout:
   - **Left:** embedded YouTube player (no need to host the video locally).
   - **Right:** scrollable panel of reference cards. Each card shows: timestamp (mono uppercase), confidence badge (`CONFIRMED` / `SPECULATIVE`), source frame thumbnail from the clip, thumbnail or external link to the cited work, the model's short justification, and a "❌ Not convinced" button.
   - **Top filter:** toggle to show/hide `SPECULATIVE` references (default: hidden).
5. Clicking a card scrubs the video to that timestamp.
6. The full report is cached in SQLite by `youtube_id`. Re-pasting the same URL = instant load. Adding `?refresh=true` forces re-analysis.

## 4. Architecture

Four backend units, one frontend, two NIM endpoints, one SQLite cache.

```
┌────────────────────┐    POST /analyze      ┌────────────────────────────────┐
│  Frontend Next.js  │  ──────────────────▶  │  Backend FastAPI (Python+uv)   │
│  - Hero form       │                       │  Pipeline orchestrator         │
│  - Report viewer   │  ◀────── SSE ───────  │   ├─ Ingestor (yt-dlp)         │
│    (dark mode)     │                       │   ├─ ShotSampler (PySceneDetect│
│                    │                       │   │    + ffmpeg)               │
│                    │                       │   ├─ FrameAnalyzer ──┐         │
│                    │                       │   ├─ RefProposer ────┼──HTTPS─▶│ NIM
│                    │                       │   └─ Verifier ───────┘         │ (Cosmos
│                    │                       │  SQLite + data/frames/         │  Reason
│                    │                       │                                │ + LLM)
└────────────────────┘                       └────────────────────────────────┘
```

### 4.1 Backend Units

Each unit has a single responsibility, a typed interface, and is independently testable.

**Ingestor** — input: YouTube URL. Output: `IngestResult { video_path: Path, title, channel, duration_s, captions?: list[Caption] }`. Uses `yt-dlp` to fetch the lowest-resolution mp4 sufficient for analysis (480p), and auto-captions if available.

**ShotSampler** — input: `video_path`. Output: `list[KeyFrame]` where `KeyFrame = { timestamp_s, frame_path, shot_id }`. Uses `PySceneDetect` (content-aware) to find shot boundaries, then extracts one representative frame per shot via `ffmpeg`. Caps at `MAX_SHOTS_PER_VIDEO` (default 80) to bound cost; if a clip exceeds this, evenly-distributed shots are kept.

**FrameAnalyzer** — input: `KeyFrame`. Output: `FrameAnalysis { timestamp_s, frame_id, composition, palette, camera_move, costume_setting, distinctive_features, raw_description, confidence_in_observation }`. Calls **Cosmos Reason** with an evidence-only prompt: describe what you see, do not speculate about references. JSON-only output enforced via Pydantic schema in the prompt and a strict-parse retry on malformed JSON.

**RefProposer** — input: full `list[FrameAnalysis]` + clip metadata + captions if available. Output: `list[ReferenceCandidate]` where each candidate = `{ timestamp_s, source_frame_id, work_title, work_creator, work_year, work_type, reasoning, raw_confidence: 0..1 }`. Calls a large text LLM (Llama 3.x 70B Instruct or Nemotron 70B) with a prompt that requires (a) named, verifiable works and (b) at least three concrete visual elements supporting each claim. Vague claims ("70s horror cinema") are explicitly rejected by the prompt.

**Verifier** — input: each `ReferenceCandidate` individually + the corresponding `FrameAnalysis`. Output: `VerifiedReference { ...candidate, verdict: "keep" | "speculative" | "reject", final_confidence, supporting_elements: list[str], wikipedia_url?: str }`. Calls the same LLM with an adversarial prompt: "defend or reject this reference using only the visual evidence provided; cite specifics or return REJECT". Optionally hits the **Wikipedia REST API** to confirm the named work exists; if not found, downgrades to `speculative`.

### 4.2 Storage

- SQLite file at `data/clipdecoder.sqlite`. Tables: `analyses(youtube_id PK, status, title, channel, duration_s, created_at, refs_json, captions_json)`, `flagged_references(id, youtube_id FK, ref_index, reason?, created_at)`.
- Frame thumbnails on disk at `data/frames/<youtube_id>/<frame_id>.jpg`.
- The downloaded mp4 is deleted after analysis completes (frames are kept, full video is not needed for the report since the embed plays from YouTube).

### 4.3 NIM Client

Thin wrapper around the OpenAI Python SDK (NIM is OpenAI-compatible). Configured via env vars:

```
NVAPI_KEY=nvapi-...
NIM_BASE_URL=https://integrate.api.nvidia.com/v1
COSMOS_REASON_MODEL=nvidia/cosmos-reason1-7b
LLM_MODEL=meta/llama-3.3-70b-instruct
```

Two helper functions: `analyze_image(frame_path, prompt) -> dict` (vision) and `complete_text(messages, response_schema) -> dict` (text with JSON-mode). Both use httpx async under the hood for parallel frame analysis (configurable concurrency, default 4).

### 4.4 API Surface

- `POST /api/analyze` — body: `{ url: str, refresh?: bool }`. If a completed report exists for that `youtube_id` and `refresh` is not true, returns `{ youtube_id, status: "cached" }` immediately. Otherwise returns `{ youtube_id, status: "running", status_stream_url }`.
- `GET /api/report/{youtube_id}` — returns the full report JSON (or 404).
- `GET /api/stream/{youtube_id}` — SSE endpoint streaming pipeline steps until completion or error.
- `POST /api/report/{youtube_id}/flag` — body: `{ ref_index: int, reason?: str }`. Stores a flag locally. No moderation, no submission elsewhere.

## 5. Hallucination Guards

Five layered defenses against fabricated references:

**5.1 Evidence-only frame analysis.** Cosmos Reason is instructed to describe only what is visible. Speculation about references is explicitly forbidden at this stage. JSON output isolates observation (`raw_description`, `distinctive_features`) from any interpretation.

**5.2 Two-pass proposer + verifier.** The RefProposer generates candidates from the aggregated frame analyses; the Verifier rejudges each candidate independently with an adversarial prompt. Verdicts: `keep` (high confidence, supporting elements specific), `speculative` (plausible but thin), `reject` (insufficient evidence — dropped from output).

**5.3 Named-and-verifiable references only.** The proposer prompt rejects vague references ("70s horror cinema", "European cinema influence"). Each reference must name a specific work with creator and year if known. The Verifier optionally pings Wikipedia REST API; works with no Wikipedia entry are downgraded to `speculative` (not rejected outright — the API misses obscure works).

**5.4 Evidence-first UI.** Each reference card displays three mandatory elements: (a) the source frame from the clip, (b) a thumbnail or external link to the cited work, (c) a short justification ("symmetry + corridor + slow tracking shot = Kubrick signature"). No justification = card is dropped before display. The user judges with their eyes; the model is forced to expose its reasoning.

**5.5 Confidence buckets and user flagging.** Three buckets: `confirmed` (default visible), `speculative` (hidden, toggle to reveal), `hidden` (dropped). The "❌ Not convinced" button stores a flag in SQLite. This flag log is never sent anywhere; it's a personal corpus for the user to inspect — and a future input for prompt iteration if the project grows.

**Acknowledged residual risk:** if Cosmos Reason hallucinates the *frame description* itself (e.g., sees a corridor that isn't there), every downstream step is poisoned. Mitigation: the report exposes the raw frame description next to the source frame on click, so the user can spot a description / image mismatch immediately.

## 6. Tech Stack & Repo Layout

### 6.1 Backend

Python 3.12, package manager **uv** (lockfile committed). Core deps:

- `fastapi`, `uvicorn[standard]` — API and SSE
- `yt-dlp` — YouTube ingestion
- `scenedetect`, `ffmpeg-python` — shot detection and frame extraction
- `httpx`, `openai` — NIM client (OpenAI-compatible)
- `sqlalchemy`, `aiosqlite` — async SQLite
- `pydantic` v2 — strict JSON schemas
- `python-dotenv` — env loading

Dev: `pytest`, `pytest-asyncio`, `respx` (httpx mock), `ruff`, `mypy`.

### 6.2 Frontend

Next.js 15 (App Router) + React 19 + TypeScript, package manager **pnpm** (recommendation; can swap for npm/bun without affecting the rest of the design). Styled per `DESIGN.md` (Together AI-inspired):

- `tailwindcss` v4 with a config that maps DESIGN.md tokens (colors, spacing, font families).
- Custom font loading: "The Future" + "PP Neue Montreal Mono" via `next/font/local` (font files placed in `frontend/public/fonts/`; user must obtain the licensed files separately or substitute fallbacks).
- Components built on `shadcn/ui` primitives, restyled to DESIGN.md (sharp 4px / 8px radius, midnight-tinted shadows, no pills).
- `react-player` for embedded YouTube playback with programmatic `seekTo`.

**Component-to-DESIGN.md mapping**:
- Hero/landing page: light section, white background with pastel pink-lavender-blue gradient, "The Future" 64px headline with -1.92px tracking, dark solid CTA button (#010120, 4px radius).
- Report page: dark zone (#010120 full-width background), white text, mono uppercase labels for timestamps and confidence badges (PP Neue Montreal Mono 11px).
- Reference cards: dark variant containers with `rgba(255, 255, 255, 0.12)` border, midnight-tinted shadow, sharp 8px radius, frame thumbnail and cited-work thumbnail side by side.
- Confidence badges: 4px-radius badges, mono uppercase 11px ("CONFIRMED" / "SPECULATIVE").
- Status streaming UI: simple stat-card style row with mono labels for each pipeline step ("INGEST", "SHOTS", "VISION", "CROSS-REF", "VERIFY") and a count or check next to each.

Dev: `vitest`, `@testing-library/react`.

### 6.3 Repository Layout

```
clipdecoder/
├── docker-compose.yml
├── .env.example
├── DESIGN.md                            # frontend design spec (existing)
├── README.md
├── docs/
│   └── superpowers/specs/
│       └── 2026-05-07-clipdecoder-design.md   # this file
├── backend/
│   ├── pyproject.toml                   # uv-managed
│   ├── uv.lock
│   ├── Dockerfile
│   ├── app/
│   │   ├── main.py                      # FastAPI app + routes + SSE
│   │   ├── pipeline/
│   │   │   ├── ingestor.py
│   │   │   ├── shot_sampler.py
│   │   │   ├── frame_analyzer.py
│   │   │   ├── ref_proposer.py
│   │   │   └── verifier.py
│   │   ├── nim/
│   │   │   └── client.py                # OpenAI-compatible wrapper
│   │   ├── models.py                    # Pydantic schemas
│   │   ├── db.py                        # SQLAlchemy + migrations
│   │   ├── settings.py                  # env loading
│   │   └── prompts/                     # versioned .md files
│   │       ├── frame_analyzer.md
│   │       ├── ref_proposer.md
│   │       └── verifier.md
│   ├── tests/
│   │   ├── unit/                        # per-unit, NIM mocked via respx
│   │   ├── golden/                      # fixtures: 2-3 known clips + expected outputs
│   │   └── integration/                 # @e2e, real NIM calls (skipped without NVAPI_KEY)
│   └── data/                            # gitignored: clipdecoder.sqlite + frames/
└── frontend/
    ├── package.json
    ├── pnpm-lock.yaml
    ├── Dockerfile
    ├── tailwind.config.ts
    ├── public/
    │   └── fonts/                       # The Future, PP Neue Montreal Mono (user-provided)
    ├── app/
    │   ├── layout.tsx                   # global font loading, theme tokens
    │   ├── page.tsx                     # hero + URL form
    │   └── report/[id]/page.tsx         # video + reference panel
    ├── components/
    │   ├── HeroForm.tsx
    │   ├── PipelineStatus.tsx           # SSE consumer
    │   ├── VideoPlayer.tsx              # react-player wrapper with seekTo
    │   ├── ReferencePanel.tsx
    │   ├── ReferenceCard.tsx
    │   ├── ConfidenceFilter.tsx
    │   └── ui/                          # shadcn primitives, restyled
    └── lib/
        ├── api.ts                       # REST + SSE client
        └── design.ts                    # DESIGN.md tokens as TS constants
```

## 7. Testing Strategy

**Unit (fast, no external calls).** Each pipeline unit tested with NIM mocked via `respx`. Verifies the IO contract of each step in isolation. Run on every commit.

**Golden tests.** Fixtures of 2–3 reference clips (one Kanye-era visual-heavy clip, one Aphex Twin–style surreal piece, one mainstream pop video). For each: stored frame analyses, stored proposer output, asserted properties on verifier output (e.g., "the verifier should keep at least one reference and reject any unnamed claim"). Detects prompt regressions without burning NIM credits in CI.

**Integration.** One end-to-end test marked `@pytest.mark.e2e`, runs the full pipeline against real NIM endpoints. Skipped automatically when `NVAPI_KEY` is missing. Run manually before each release.

**Frontend.** Vitest + Testing Library for the confidence-filter logic and SSE consumer state machine. Skip Playwright for v1.

## 8. Open Questions / Risks

- **Cosmos Reason model name and exact JSON-mode support.** The model ID may shift; the `nim/client.py` wrapper isolates this. JSON-mode behavior on Cosmos Reason vision endpoints needs verification — fallback is regex extraction with retry.
- **Wikipedia coverage of niche works.** Many obscure films and music videos lack Wikipedia entries. The verifier downgrades rather than rejects when Wikipedia is silent, to avoid false negatives.
- **YouTube anti-bot measures.** `yt-dlp` occasionally requires cookie files for age-restricted or region-locked content. v1 documents this in the README; a future enhancement could expose a `cookies.txt` mount in `docker-compose.yml`.
- **Cost / latency.** A 4-minute clip with ~30 shots at 4-way concurrency: roughly 8 vision calls + 1 proposer call + 30 verifier calls = ~40 NIM requests. With the free-tier 1000-credit allowance, that's ~25 clips per refill. The `MAX_SHOTS_PER_VIDEO` cap keeps cost bounded; the `?refresh=true` flag is opt-in to prevent accidental re-burns.
- **Font licensing.** "The Future" and "PP Neue Montreal Mono" are commercial fonts. The repo ships with system fallbacks (`Arial`, `Georgia`) and instructs users to drop licensed font files into `frontend/public/fonts/` if they own them.

## 9. Success Criteria

The v1 ships when:

- A user can paste a YouTube URL of a known visual-rich music video and receive a report in under 3 minutes on a typical broadband connection.
- The report contains at least one `confirmed` reference for clips that genuinely cite recognizable works (validated against the golden fixtures).
- Zero references with vague descriptors ("60s cinema", "European art film") appear in the `confirmed` bucket — the proposer prompt and verifier filters reject these reliably across the golden set.
- The full stack runs from a single `docker compose up` after filling `.env` with a valid `nvapi-` key. No other setup steps required.
- The codebase is clean enough to invite contributions: documented prompts in versioned .md files, typed Pydantic schemas, and a passing `pytest` + `vitest` suite.
