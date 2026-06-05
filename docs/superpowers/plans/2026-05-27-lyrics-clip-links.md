# Lyrics × Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a report section that explains how a music video's imagery relates to its lyrics — a moment-by-moment timeline pairing notable lyric lines with the on-screen frame and a one-line reading of the connection.

**Architecture:** Re-enable yt-dlp auto-captions in the ingestor; add a dedicated, toggleable `LyricsLinker` LLM stage that pairs lyric lines to frames (one NIM call, best-effort); store the result on `Report.lyrics_links`; render it in the report behind a References / Lyrics × Visuals tab switch so page height doesn't grow.

**Tech Stack:** Python 3.12 (FastAPI, Pydantic, yt-dlp, httpx, pytest/respx), Next.js 15 / React 19 / Tailwind 4 (vitest + Testing Library).

---

## Conventions

- Backend tests run from `backend/`: `uv run pytest tests/unit/<file> -v`.
- Frontend tests run from `frontend/`: `pnpm test <file>` (vitest).
- Commit messages follow Conventional Commits (`type(scope): subject`).
- Pydantic models: validate-and-drop on bad LLM output, never raise from a best-effort stage.

---

## File Structure

**Backend**
- `app/models.py` — add `LyricLink`; add `Report.lyrics_links`.
- `app/settings.py` — add `lyrics_linking`, `max_lyric_links`.
- `app/pipeline/ingestor.py` — re-enable auto-captions; add `_parse_json3` + caption loading.
- `app/pipeline/lyrics_linker.py` *(new)* — the `LyricsLinker` stage.
- `app/prompts/lyrics_linker.md` *(new)* — the linker prompt.
- `app/pipeline/orchestrator.py` — call the linker, store links.
- `app/main.py` — inject `LyricsLinker` gated by `settings.lyrics_linking`.
- Tests: `tests/unit/test_models.py`, `tests/unit/test_ingestor.py`, `tests/unit/test_lyrics_linker.py` *(new)*.

**Frontend**
- `lib/types.ts` — add `LyricLink`, `Report.lyrics_links`.
- `components/report/LyricsTimeline.tsx` *(new)* + `LyricsTimeline.test.tsx` *(new)*.
- `components/report/ReportContent.tsx` — tabs; scope `FilterBar` to the References tab.
- `components/report/ReportContent.test.tsx` — tab behaviour cases.

**Docs / config**
- `.env.example`, `README.md`.

---

## Task 1: Backend data model — `LyricLink` + `Report.lyrics_links`

**Files:**
- Modify: `backend/app/models.py`
- Test: `backend/tests/unit/test_models.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/unit/test_models.py`:

```python
def test_lyric_link_roundtrips_and_report_defaults_empty():
    from app.models import LyricLink, Report

    link = LyricLink(
        lyric_timestamp_s=42.5,
        lyric="running through the city",
        frame_id="shot_03",
        frame_timestamp_s=43.0,
        relation="literal",
        note="streaked night streets",
    )
    assert link.relation == "literal"

    # Report defaults lyrics_links to [] (back-compat for old rows).
    report = Report(
        youtube_id="abc",
        title="T",
        channel="C",
        duration_s=100.0,
        references=[],
        frame_analyses=[],
    )
    assert report.lyrics_links == []

    # And a Report carrying links round-trips through JSON.
    report2 = Report.model_validate(
        {**report.model_dump(), "lyrics_links": [link.model_dump()]}
    )
    assert report2.lyrics_links[0].frame_id == "shot_03"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_models.py::test_lyric_link_roundtrips_and_report_defaults_empty -v`
Expected: FAIL with `ImportError: cannot import name 'LyricLink'`.

- [ ] **Step 3: Add the model and field**

In `backend/app/models.py`, add after the `FrameAnalysis` class (before `ReferenceCandidate`):

```python
class LyricLink(BaseModel):
    lyric_timestamp_s: Annotated[float, Field(ge=0.0)]
    lyric: str
    frame_id: str
    frame_timestamp_s: Annotated[float, Field(ge=0.0)]
    relation: str  # literal | motif | contrast | amplification | other
    note: str
```

In the `Report` class, add the field after `frame_analyses`:

```python
class Report(BaseModel):
    youtube_id: str
    title: str
    channel: str
    duration_s: Annotated[float, Field(ge=0.0)]
    references: list[VerifiedReference]
    frame_analyses: list[FrameAnalysis]
    lyrics_links: list[LyricLink] = []
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_models.py -v`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/unit/test_models.py
git commit -m "feat(models): add LyricLink and Report.lyrics_links"
```

---

## Task 2: Settings flags

**Files:**
- Modify: `backend/app/settings.py`
- Modify: `.env.example`

- [ ] **Step 1: Add settings fields**

In `backend/app/settings.py`, add after the `wikidata_timeout_s` line:

```python
    # Lyrics × Visuals linking: a dedicated LLM pass that pairs notable
    # lyric lines (from auto-captions) to on-screen frames. Independent of
    # the reference pipeline; disable to skip the extra NIM call entirely.
    lyrics_linking: bool = True
    max_lyric_links: int = 10
```

- [ ] **Step 2: Document in `.env.example`**

Add to `.env.example` after the Wikidata lines:

```
LYRICS_LINKING=true
MAX_LYRIC_LINKS=10
```

- [ ] **Step 3: Verify settings import cleanly**

Run: `cd backend && uv run python -c "from app.settings import settings; print(settings.lyrics_linking, settings.max_lyric_links)"`
Expected: `True 10`

- [ ] **Step 4: Commit**

```bash
git add backend/app/settings.py .env.example
git commit -m "feat(settings): add lyrics_linking and max_lyric_links knobs"
```

---

## Task 3: Caption parsing — `_parse_json3`

YouTube `json3` auto-captions emit overlapping rolling events (each cue re-emits the previous words plus a new one) and non-lyric markers like `[Music]`. This pure helper turns the raw JSON into clean `Caption` lines.

**Files:**
- Modify: `backend/app/pipeline/ingestor.py`
- Test: `backend/tests/unit/test_ingestor.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/unit/test_ingestor.py`:

```python
def test_parse_json3_coalesces_rolling_lines_and_drops_markers():
    import json
    from app.pipeline.ingestor import _parse_json3

    # Rolling build-up of one line, then a [Music] marker, then a final line.
    payload = json.dumps({
        "events": [
            {"tStartMs": 1000, "dDurationMs": 500, "segs": [{"utf8": "I'm"}]},
            {"tStartMs": 1100, "dDurationMs": 500,
             "segs": [{"utf8": "I'm "}, {"utf8": "running"}]},
            {"tStartMs": 1200, "dDurationMs": 800,
             "segs": [{"utf8": "I'm running "}, {"utf8": "through the city"}]},
            {"tStartMs": 5000, "dDurationMs": 300, "segs": [{"utf8": "[Music]"}]},
            {"tStartMs": 6000, "dDurationMs": 900,
             "segs": [{"utf8": "gold on my mind"}]},
            {"tStartMs": 7000, "dDurationMs": 100, "segs": [{"utf8": "\n"}]},
        ]
    })

    caps = _parse_json3(payload)
    texts = [c.text for c in caps]
    # Rolling prefixes collapse to the final, longest form; marker + blank dropped.
    assert texts == ["I'm running through the city", "gold on my mind"]
    assert caps[0].start_s == 1.2
    assert caps[1].start_s == 6.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_ingestor.py::test_parse_json3_coalesces_rolling_lines_and_drops_markers -v`
Expected: FAIL with `ImportError: cannot import name '_parse_json3'`.

- [ ] **Step 3: Implement the helper**

In `backend/app/pipeline/ingestor.py`, add near the top after the imports (and add `import json`):

```python
import json

_BRACKET_MARKER_RE = re.compile(r"^[\[(].*[\])]$")
_WS_RE = re.compile(r"\s+")
_NON_LYRIC = {"♪", "♪♪"}


def _parse_json3(text: str) -> list["Caption"]:
    """Parse a YouTube json3 subtitle blob into clean Caption lines.

    Coalesces the rolling auto-caption build-up (a line re-emitted word by
    word across consecutive events) down to its final form, and drops
    non-lyric markers like [Music] / [Applause] and blank cues.
    """
    data = json.loads(text)
    raw: list[Caption] = []
    for ev in data.get("events", []):
        segs = ev.get("segs")
        if not segs:
            continue
        line = "".join(s.get("utf8", "") for s in segs)
        line = _WS_RE.sub(" ", line).strip()
        if not line or line in _NON_LYRIC or _BRACKET_MARKER_RE.match(line):
            continue
        start = float(ev.get("tStartMs", 0)) / 1000.0
        dur = float(ev.get("dDurationMs", 0)) / 1000.0
        raw.append(Caption(start_s=start, end_s=start + dur, text=line))

    out: list[Caption] = []
    for i, cap in enumerate(raw):
        nxt = raw[i + 1] if i + 1 < len(raw) else None
        # Rolling build-up: drop a line that is a prefix of the next one.
        if nxt is not None and nxt.text.startswith(cap.text):
            continue
        # Drop consecutive exact duplicates.
        if out and out[-1].text == cap.text:
            continue
        out.append(cap)
    return out
```

Add `Caption` to the model import at the top of the file:

```python
from app.models import Caption, IngestResult
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_ingestor.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/pipeline/ingestor.py backend/tests/unit/test_ingestor.py
git commit -m "feat(ingestor): parse YouTube json3 captions into clean lines"
```

---

## Task 4: Re-enable auto-caption download in the ingestor

**Files:**
- Modify: `backend/app/pipeline/ingestor.py`
- Test: `backend/tests/unit/test_ingestor.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/unit/test_ingestor.py`:

```python
def test_ingest_loads_captions_from_requested_subtitles(tmp_path: Path):
    import json
    fake_video = tmp_path / "vid.mp4"
    fake_video.write_bytes(b"fake")
    sub_file = tmp_path / "vid.en.json3"
    sub_file.write_text(json.dumps({
        "events": [
            {"tStartMs": 1000, "dDurationMs": 900,
             "segs": [{"utf8": "gold on my mind"}]},
        ]
    }), encoding="utf-8")

    info = {
        "id": "dQw4w9WgXcQ",
        "title": "Test Title",
        "channel": "Test Channel",
        "duration": 240,
        "language": "en",
        "subtitles": {},
        "automatic_captions": {"en": [{"ext": "json3"}]},
        "requested_subtitles": {"en": {"filepath": str(sub_file)}},
    }

    fake_ydl = MagicMock()
    fake_ydl.__enter__.return_value = fake_ydl
    fake_ydl.__exit__.return_value = False
    fake_ydl.extract_info.return_value = info
    fake_ydl.prepare_filename.return_value = str(fake_video)

    with patch("app.pipeline.ingestor.YoutubeDL", return_value=fake_ydl):
        ing = Ingestor(work_dir=tmp_path)
        result = ing.ingest("https://www.youtube.com/watch?v=dQw4w9WgXcQ")

    assert [c.text for c in result.captions] == ["gold on my mind"]
    # Subtitle file is cleaned up after parsing.
    assert not sub_file.exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_ingestor.py::test_ingest_loads_captions_from_requested_subtitles -v`
Expected: FAIL (`result.captions == []`).

- [ ] **Step 3: Rework `_ydl_opts` and `ingest`**

Replace the `_ydl_opts` method and `ingest` method in `backend/app/pipeline/ingestor.py` with:

```python
    def _ydl_opts(
        self, youtube_id: str, subtitle_langs: list[str] | None = None
    ) -> dict[str, Any]:
        out_template = str(self._work_dir / f"{youtube_id}.%(ext)s")
        opts: dict[str, Any] = {
            "format": "best[height<=480][ext=mp4]/best[height<=480]/best[ext=mp4]/best",
            "outtmpl": out_template,
            "quiet": True,
            "no_warnings": True,
            "writesubtitles": False,
            "writeautomaticsub": False,
            "skip_download": False,
            "noplaylist": True,
            "max_filesize": MAX_FILESIZE_BYTES,
        }
        if subtitle_langs:
            opts.update({
                "writesubtitles": True,
                "writeautomaticsub": True,
                "subtitlesformat": "json3",
                "subtitleslangs": subtitle_langs,
            })
        return opts

    def _choose_caption_langs(self, info: dict[str, Any]) -> list[str]:
        available = {
            **(info.get("automatic_captions") or {}),
            **(info.get("subtitles") or {}),
        }
        if not available:
            return []
        lang = info.get("language") or ""
        for pref in (lang, lang.split("-")[0], "en"):
            if pref and pref in available:
                return [pref]
        return [next(iter(available))]

    def _load_captions(
        self, info: dict[str, Any], youtube_id: str
    ) -> list[Caption]:
        candidates: list[Path] = []
        for sub in (info.get("requested_subtitles") or {}).values():
            fp = sub.get("filepath") if isinstance(sub, dict) else None
            if fp:
                candidates.append(Path(fp))
        candidates.extend(self._work_dir.glob(f"{youtube_id}*.json3"))

        for path in candidates:
            if not path.exists():
                continue
            try:
                caps = _parse_json3(path.read_text(encoding="utf-8"))
            except Exception:
                caps = []
            finally:
                path.unlink(missing_ok=True)
            if caps:
                return caps
        return []

    def ingest(self, url: str) -> IngestResult:
        youtube_id = parse_youtube_id(url)
        # Probe metadata (cheap, no download) to enforce the duration cap
        # and discover which caption languages exist before committing.
        with YoutubeDL(self._ydl_opts(youtube_id)) as ydl:
            probe = ydl.extract_info(url, download=False)
        duration = float(probe.get("duration") or 0)
        if duration > MAX_DURATION_S:
            minutes = MAX_DURATION_S // 60
            raise ValueError(
                f"Clip too long ({duration:.0f}s). "
                f"Maximum supported is {minutes} minutes."
            )

        langs = self._choose_caption_langs(probe)
        with YoutubeDL(self._ydl_opts(youtube_id, subtitle_langs=langs)) as ydl:
            info = ydl.extract_info(url, download=True)
            video_path = Path(ydl.prepare_filename(info))

        captions = self._load_captions(info, youtube_id) if langs else []
        return IngestResult(
            youtube_id=youtube_id,
            video_path=video_path,
            title=info.get("title", ""),
            channel=info.get("channel") or info.get("uploader", ""),
            duration_s=float(info.get("duration") or 0),
            captions=captions,
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_ingestor.py -v`
Expected: PASS (including the original `test_ingest_returns_metadata`, which has empty `automatic_captions` → `captions == []`).

- [ ] **Step 5: Commit**

```bash
git add backend/app/pipeline/ingestor.py backend/tests/unit/test_ingestor.py
git commit -m "feat(ingestor): download and parse YouTube auto-captions"
```

---

## Task 5: The `LyricsLinker` stage + prompt

**Files:**
- Create: `backend/app/pipeline/lyrics_linker.py`
- Create: `backend/app/prompts/lyrics_linker.md`
- Test: `backend/tests/unit/test_lyrics_linker.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_lyrics_linker.py`:

```python
from unittest.mock import AsyncMock
from app.models import Caption, FrameAnalysis
from app.pipeline.lyrics_linker import LyricsLinker


def _fa(frame_id: str, ts: float) -> FrameAnalysis:
    return FrameAnalysis(
        timestamp_s=ts, frame_id=frame_id,
        composition="neon corridor", palette=["red"],
        camera_move="static", costume_setting="city street at night",
        distinctive_features=["motion blur"], raw_description="streets",
        confidence_in_observation=0.9,
    )


def _cap(ts: float, text: str) -> Caption:
    return Caption(start_s=ts, end_s=ts + 1.0, text=text)


def _payload(links):
    return {"links": links}


async def test_links_validated_and_relation_normalized():
    nim = AsyncMock()
    nim.complete_text.return_value = _payload([
        {
            "lyric_timestamp_s": 42.0, "lyric": "running through the city",
            "frame_id": "shot_03", "frame_timestamp_s": 43.0,
            "relation": "LITERAL-ish", "note": "streaked night streets",
        },
    ])
    linker = LyricsLinker(nim_client=nim, model="m")
    out = await linker.link(
        title="t", captions=[_cap(42.0, "running through the city")],
        frame_analyses=[_fa("shot_03", 43.0)],
    )
    assert len(out) == 1
    assert out[0].relation == "other"  # unknown value normalized
    assert out[0].frame_id == "shot_03"


async def test_empty_captions_short_circuits_without_nim_call():
    nim = AsyncMock()
    linker = LyricsLinker(nim_client=nim, model="m")
    out = await linker.link(title="t", captions=[], frame_analyses=[_fa("shot_00", 0.0)])
    assert out == []
    nim.complete_text.assert_not_awaited()


async def test_link_with_unknown_frame_id_is_dropped():
    nim = AsyncMock()
    nim.complete_text.return_value = _payload([
        {
            "lyric_timestamp_s": 1.0, "lyric": "x", "frame_id": "shot_99",
            "frame_timestamp_s": 1.0, "relation": "literal", "note": "n",
        },
    ])
    linker = LyricsLinker(nim_client=nim, model="m")
    out = await linker.link(
        title="t", captions=[_cap(1.0, "x")], frame_analyses=[_fa("shot_00", 0.0)]
    )
    assert out == []


async def test_links_capped_at_max():
    nim = AsyncMock()
    nim.complete_text.return_value = _payload([
        {
            "lyric_timestamp_s": float(i), "lyric": f"l{i}", "frame_id": "shot_00",
            "frame_timestamp_s": 0.0, "relation": "motif", "note": "n",
        }
        for i in range(5)
    ])
    linker = LyricsLinker(nim_client=nim, model="m", max_links=2)
    out = await linker.link(
        title="t", captions=[_cap(0.0, "l")], frame_analyses=[_fa("shot_00", 0.0)]
    )
    assert len(out) == 2


async def test_nim_failure_returns_empty():
    nim = AsyncMock()
    nim.complete_text.side_effect = RuntimeError("boom")
    linker = LyricsLinker(nim_client=nim, model="m")
    out = await linker.link(
        title="t", captions=[_cap(1.0, "x")], frame_analyses=[_fa("shot_00", 0.0)]
    )
    assert out == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_lyrics_linker.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.pipeline.lyrics_linker'`.

- [ ] **Step 3: Create the prompt**

Create `backend/app/prompts/lyrics_linker.md`:

```markdown
You are a music-video critic. You receive a song's lyric lines (with timestamps) and structured descriptions of frames from its official video. Your job is to identify the most telling moments where the **visuals connect to the words**, and explain each connection in one short line.

# Inputs

Title: {title}

Lyric lines (timestamped, may be noisy auto-transcription):
{lyric_lines}

Frame summaries (timestamped):
{frame_summaries}

# Rules

1. Choose at most {max_links} of the strongest lyric→visual connections. Fewer is fine. Skip filler lines.
2. Each link MUST reference a real `frame_id` from the frame summaries above.
3. `lyric` is the (lightly cleaned) lyric line. `lyric_timestamp_s` is that line's time.
4. Classify each connection's `relation` as exactly one of:
   - "literal" — the visual literally depicts what the line says.
   - "motif" — a recurring symbol, color, or image tied to the line's theme.
   - "contrast" — the visual contradicts or ironizes the line.
   - "amplification" — the visual heightens the line's emotion.
   - "other" — a real connection that fits none of the above.
5. `note` is ONE concise clause (max ~12 words) naming the connection. No restating the lyric verbatim.
6. Prefer spreading picks across the song over clustering them.

# Output

Strict JSON. No markdown. No prose outside JSON.

```
{{
  "links": [
    {{
      "lyric_timestamp_s": <float>,
      "lyric": "<lyric line>",
      "frame_id": "<shot_NN from the summaries>",
      "frame_timestamp_s": <float>,
      "relation": "literal" | "motif" | "contrast" | "amplification" | "other",
      "note": "<one short clause>"
    }}
  ]
}}
```
```

- [ ] **Step 4: Create the linker module**

Create `backend/app/pipeline/lyrics_linker.py`:

```python
from __future__ import annotations
import logging
from typing import Awaitable, Callable
from pydantic import ValidationError
from app.models import Caption, FrameAnalysis, LyricLink
from app.nim.client import NimClient
from app.prompts.loader import load_prompt

logger = logging.getLogger(__name__)

_RELATIONS = {"literal", "motif", "contrast", "amplification", "other"}


def _escape_braces(s: str) -> str:
    return s.replace("{", "{{").replace("}", "}}")


def _format_lyric_lines(captions: list[Caption]) -> str:
    return _escape_braces(
        "\n".join(f"[{c.start_s:.1f}s] {c.text}" for c in captions)
    )


def _format_frame_summaries(frames: list[FrameAnalysis]) -> str:
    blocks = [
        f"[{f.frame_id} @ {f.timestamp_s:.1f}s] {f.composition}; "
        f"setting={f.costume_setting}; "
        f"features={', '.join(f.distinctive_features)}"
        for f in frames
    ]
    return _escape_braces("\n".join(blocks))


class LyricsLinker:
    """Pairs notable lyric lines to on-screen frames via one LLM call.

    Best-effort: any failure (no captions, NIM error, bad JSON) yields an
    empty list — this stage must never fail an otherwise-successful run.
    """

    def __init__(self, nim_client: NimClient, model: str, max_links: int = 10):
        self._nim = nim_client
        self._model = model
        self._max_links = max_links
        self._tpl = load_prompt("lyrics_linker")

    async def link(
        self,
        *,
        title: str,
        captions: list[Caption],
        frame_analyses: list[FrameAnalysis],
        on_progress: Callable[[str, float], Awaitable[None]] | None = None,
    ) -> list[LyricLink]:
        if not captions:
            return []
        frame_ids = {f.frame_id for f in frame_analyses}
        ctx = {
            "title": _escape_braces(title or "(unknown)"),
            "lyric_lines": _format_lyric_lines(captions),
            "frame_summaries": _format_frame_summaries(frame_analyses),
            "max_links": self._max_links,
        }
        if on_progress:
            await on_progress("Linking lyrics to visuals…", 0.97)
        try:
            data = await self._nim.complete_text(
                model=self._model,
                messages=[{"role": "user", "content": self._tpl.format(**ctx)}],
                json_mode=True,
            )
        except Exception:
            logger.exception("lyrics linking failed — skipping section")
            return []

        raw = data.get("links") or []
        out: list[LyricLink] = []
        for item in raw:
            try:
                link = LyricLink.model_validate(item)
            except ValidationError as e:
                logger.debug("dropped invalid lyric link %r: %s", item, e)
                continue
            if link.frame_id not in frame_ids:
                logger.debug("dropped lyric link with unknown frame %r", link.frame_id)
                continue
            if link.relation not in _RELATIONS:
                link.relation = "other"
            out.append(link)
            if len(out) >= self._max_links:
                break
        return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_lyrics_linker.py -v`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/pipeline/lyrics_linker.py backend/app/prompts/lyrics_linker.md backend/tests/unit/test_lyrics_linker.py
git commit -m "feat(pipeline): add LyricsLinker stage + prompt"
```

---

## Task 6: Wire the linker into the orchestrator + app

The orchestrator already joins `ingest.captions` into `lyrics` for the cross-ref prompt (now non-empty again as a bonus). Here we run the linker after enrichment and store its result on the `Report`. The progress log reuses the existing `verify` step channel (matching how Wikidata enrichment logs), so no new frontend pipeline step is needed.

**Files:**
- Modify: `backend/app/pipeline/orchestrator.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/unit/test_orchestrator.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/unit/test_orchestrator.py`. This follows the same inline-mock pattern as `test_orchestrator_emits_enrich_step_and_uses_enriched_refs` and reads the saved report via `db_mock.save_report.call_args.args[0]`. The stub ingestor returns a non-empty `captions` list so the linker actually runs:

```python
async def test_orchestrator_stores_lyrics_links(tmp_path: Path):
    from app.models import Caption, LyricLink

    keyframes, fa_results, candidates = _default_fixtures(tmp_path)

    verifier = AsyncMock()
    verifier.verify_all.return_value = [
        VerifiedReference(
            **candidates[0].model_dump(),
            verdict=Verdict.KEEP,
            final_confidence=Confidence.CONFIRMED,
            supporting_elements=["a"],
            wikipedia_url=None,
            cross_ref_reasoning="cr",
            adversarial_reasoning="ad",
            wikipedia_reasoning="wk",
        )
    ]

    lyrics_linker = AsyncMock()
    lyrics_linker.link.return_value = [
        LyricLink(
            lyric_timestamp_s=1.0, lyric="gold on my mind",
            frame_id="shot_00", frame_timestamp_s=1.0,
            relation="motif", note="palette warms to gold",
        )
    ]

    db_mock = AsyncMock()
    db_mock.get_status = AsyncMock(return_value=AnalysisStatus.DONE)
    db_mock.save_report = AsyncMock()
    db_mock.set_status = AsyncMock()
    bus = EventBus()

    ingestor = MagicMock()
    ingestor.ingest.return_value = IngestResult(
        youtube_id="abc", video_path=tmp_path / "v.mp4",
        title="t", channel="c", duration_s=10.0,
        captions=[Caption(start_s=1.0, end_s=2.0, text="gold on my mind")],
    )
    sampler = MagicMock()
    sampler.sample.return_value = keyframes

    async def _analyze(kfs, on_frame=None):
        return fa_results
    frame_analyzer = MagicMock()
    frame_analyzer.analyze = _analyze

    async def _propose(**kw):
        return candidates
    proposer = MagicMock()
    proposer.propose = _propose

    orch = Orchestrator(
        db=db_mock, bus=bus,
        ingestor=ingestor, sampler=sampler,
        frame_analyzer=frame_analyzer,
        ref_proposer=proposer, verifier=verifier,
        lyrics_linker=lyrics_linker,
    )

    async def collect():
        async for ev in bus.subscribe("abc"):
            if ev.step == "done":
                return
    consumer = asyncio.create_task(collect())
    await orch.run("https://www.youtube.com/watch?v=abc")
    await asyncio.wait_for(consumer, timeout=2.0)

    lyrics_linker.link.assert_awaited_once()
    saved_report = db_mock.save_report.call_args.args[0]
    assert saved_report.lyrics_links[0].relation == "motif"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_orchestrator.py::test_orchestrator_stores_lyrics_links -v`
Expected: FAIL — `Orchestrator.__init__` rejects `lyrics_linker`, or `report.lyrics_links == []`.

- [ ] **Step 3: Add the constructor param**

In `backend/app/pipeline/orchestrator.py`, add the import:

```python
from app.pipeline.lyrics_linker import LyricsLinker
```

Add the parameter to `__init__` (after `enricher`):

```python
        enricher: WikidataEnricher | None = None,
        lyrics_linker: LyricsLinker | None = None,
    ):
```

and store it (after `self._enricher = enricher`):

```python
        self._lyrics_linker = lyrics_linker
```

- [ ] **Step 4: Call the linker before building the Report**

In `orchestrator.run`, locate the block that sorts `enriched` and builds `report`. Immediately **before** `enriched.sort(...)`, insert:

```python
            lyrics_links = []
            if self._lyrics_linker is not None and ingest.captions:
                try:
                    lyrics_links = await self._lyrics_linker.link(
                        title=ingest.title,
                        captions=ingest.captions,
                        frame_analyses=frame_analyses,
                        on_progress=_on_verify_progress,
                    )
                except Exception:
                    logger.exception("lyrics linking raised — continuing")
                    lyrics_links = []
```

Then add `lyrics_links=lyrics_links` to the `Report(...)` constructor call:

```python
            report = Report(
                youtube_id=yid,
                title=ingest.title,
                channel=ingest.channel,
                duration_s=ingest.duration_s,
                references=kept,
                frame_analyses=frame_analyses,
                lyrics_links=lyrics_links,
            )
```

- [ ] **Step 5: Inject the linker in `main.py`**

In `backend/app/main.py`, add the import alongside the other pipeline imports:

```python
from app.pipeline.lyrics_linker import LyricsLinker
```

In `_build_default_app`, add `lyrics_linker` to the `Orchestrator(...)` call after `enricher=enricher,`:

```python
        enricher=enricher,
        lyrics_linker=(
            LyricsLinker(
                nim_client=nim,
                model=settings.llm_model,
                max_links=settings.max_lyric_links,
            )
            if settings.lyrics_linking
            else None
        ),
    )
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_orchestrator.py -v`
Expected: PASS (new test + all existing orchestrator tests, which pass `lyrics_linker=None` by default).

- [ ] **Step 7: Full backend suite + import smoke test**

Run: `cd backend && uv run pytest -q && uv run python -c "from app.main import _build_default_app; _build_default_app()"`
Expected: all tests pass; app builds with no error.

- [ ] **Step 8: Commit**

```bash
git add backend/app/pipeline/orchestrator.py backend/app/main.py backend/tests/unit/test_orchestrator.py
git commit -m "feat(pipeline): run LyricsLinker and store links on the report"
```

---

## Task 7: Frontend types

**Files:**
- Modify: `frontend/lib/types.ts`

- [ ] **Step 1: Add the `LyricLink` interface**

In `frontend/lib/types.ts`, add after the `FrameAnalysis` interface:

```ts
export interface LyricLink {
  lyric_timestamp_s: number;
  lyric: string;
  frame_id: string;
  frame_timestamp_s: number;
  relation: string; // literal | motif | contrast | amplification | other
  note: string;
}
```

- [ ] **Step 2: Add the field to `Report`**

In the `Report` interface, add after `frame_analyses`:

```ts
  lyrics_links?: LyricLink[];
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts
git commit -m "feat(types): add LyricLink and Report.lyrics_links"
```

---

## Task 8: `LyricsTimeline` component

**Files:**
- Create: `frontend/components/report/LyricsTimeline.tsx`
- Test: `frontend/components/report/LyricsTimeline.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/components/report/LyricsTimeline.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LyricsTimeline } from "./LyricsTimeline";
import type { LyricLink } from "@/lib/types";

const links: LyricLink[] = [
  {
    lyric_timestamp_s: 42,
    lyric: "running through the city",
    frame_id: "shot_03",
    frame_timestamp_s: 43,
    relation: "literal",
    note: "streaked night streets",
  },
  {
    lyric_timestamp_s: 75,
    lyric: "gold on my mind",
    frame_id: "shot_07",
    frame_timestamp_s: 75,
    relation: "motif",
    note: "palette warms to gold",
  },
];

describe("LyricsTimeline", () => {
  it("renders one row per link with lyric, note and relation", () => {
    render(<LyricsTimeline links={links} youtubeId="abc" onSeek={() => {}} />);
    expect(screen.getByText(/running through the city/)).toBeInTheDocument();
    expect(screen.getByText(/streaked night streets/)).toBeInTheDocument();
    expect(screen.getByText(/literal/i)).toBeInTheDocument();
    expect(screen.getByText(/01:15/)).toBeInTheDocument(); // 75s formatted
  });

  it("calls onSeek with the lyric timestamp when a row is clicked", () => {
    const onSeek = vi.fn();
    render(<LyricsTimeline links={links} youtubeId="abc" onSeek={onSeek} />);
    fireEvent.click(screen.getByRole("button", { name: /running through the city/i }));
    expect(onSeek).toHaveBeenCalledWith(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm test LyricsTimeline -- --run`
Expected: FAIL — cannot resolve `./LyricsTimeline`.

- [ ] **Step 3: Implement the component**

Create `frontend/components/report/LyricsTimeline.tsx`:

```tsx
"use client";
import type { LyricLink } from "@/lib/types";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

const RELATION_VARIANT: Record<string, string> = {
  literal:
    "bg-[color:color-mix(in_oklab,var(--grad-peach)_18%,var(--surface-strong))] border-[color:color-mix(in_oklab,var(--grad-peach)_30%,transparent)] text-grad-peach",
  motif:
    "bg-[color:color-mix(in_oklab,var(--grad-sky)_16%,var(--surface-strong))] border-[color:color-mix(in_oklab,var(--grad-sky)_30%,transparent)] text-grad-sky",
  contrast: "bg-surface-strong border-l-error border-hairline text-error",
  amplification: "bg-surface-strong border-hairline text-body",
  other: "bg-surface-strong border-hairline text-muted",
};

const CHIP =
  "inline-flex items-center px-2 py-[2px] rounded-full border font-sans text-[10px] font-semibold uppercase tracking-[0.06em]";

export function LyricsTimeline({
  links,
  youtubeId,
  onSeek,
}: {
  links: LyricLink[];
  youtubeId: string;
  onSeek: (t: number) => void;
}) {
  if (links.length === 0) return null;
  return (
    <ol className="relative z-[1] list-none m-0 p-0 flex flex-col gap-3 px-[clamp(32px,5vw,64px)] py-8">
      {links.map((link, i) => (
        <li key={`${link.frame_id}-${i}`}>
          <button
            type="button"
            onClick={() => onSeek(link.lyric_timestamp_s)}
            className="w-full text-left grid grid-cols-[auto_88px_1fr] items-center gap-4 p-3 bg-surface-card border border-hairline rounded-2 transition-colors duration-200 hover:border-hairline-strong"
          >
            <span className="font-sans text-[11px] font-medium uppercase tracking-uc text-muted tabular-nums self-start pt-1">
              {formatTimecode(link.lyric_timestamp_s)}
            </span>
            <span
              className="aspect-video w-full bg-cover bg-center bg-surface-strong rounded-1"
              style={{
                backgroundImage: `url(/api/frames/${youtubeId}/${link.frame_id})`,
              }}
            />
            <span className="flex flex-col gap-1.5 min-w-0">
              <span className="flex items-center gap-2 flex-wrap">
                <em className="font-serif italic text-ink text-[clamp(15px,1.4vw,18px)] leading-snug">
                  “{link.lyric}”
                </em>
                <span className={`${CHIP} ${RELATION_VARIANT[link.relation] ?? RELATION_VARIANT.other}`}>
                  {link.relation}
                </span>
              </span>
              <span className="font-sans text-[13px] leading-[1.5] text-body">
                {link.note}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && pnpm test LyricsTimeline -- --run`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/report/LyricsTimeline.tsx frontend/components/report/LyricsTimeline.test.tsx
git commit -m "feat(report): add LyricsTimeline component"
```

---

## Task 9: Tabs in `ReportContent` + scope `FilterBar`

**Files:**
- Modify: `frontend/components/report/ReportContent.tsx`
- Test: `frontend/components/report/ReportContent.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/components/report/ReportContent.test.tsx` (inside the file, after the existing `describe` block):

```tsx
import { screen, fireEvent } from "@testing-library/react";
import type { LyricLink } from "@/lib/types";

const lyricLink: LyricLink = {
  lyric_timestamp_s: 42,
  lyric: "gold on my mind",
  frame_id: "shot_00",
  frame_timestamp_s: 42,
  relation: "motif",
  note: "palette warms to gold",
};

describe("ReportContent tabs", () => {
  it("shows no tab switch when there are no lyrics links", () => {
    render(<ReportContent report={fakeReport} youtubeId="abc" />);
    expect(screen.queryByRole("tab", { name: /lyrics/i })).not.toBeInTheDocument();
  });

  it("shows tabs and switches to the lyrics timeline when links exist", () => {
    const report = { ...fakeReport, lyrics_links: [lyricLink] };
    render(<ReportContent report={report} youtubeId="abc" />);
    // References tab is the default; lyric text not visible yet.
    expect(screen.queryByText(/gold on my mind/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /lyrics/i }));
    expect(screen.getByText(/gold on my mind/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && pnpm test ReportContent -- --run`
Expected: FAIL — no `tab` role rendered.

- [ ] **Step 3: Add tab state and the tab bar**

In `frontend/components/report/ReportContent.tsx`:

(a) Add the import:

```tsx
import { LyricsTimeline } from "@/components/report/LyricsTimeline";
```

(b) After the existing `useState` declarations near the top of the component, add:

```tsx
  const lyricsLinks = report.lyrics_links ?? [];
  const hasLyrics = lyricsLinks.length > 0;
  const [activeTab, setActiveTab] = useState<"references" | "lyrics">("references");
```

(c) Add a `jumpToTime` helper and refactor `jumpTo` to use it. Replace the existing `jumpTo` function with:

```tsx
  function jumpToTime(t: number) {
    playerRef.current?.seekTo(t);
    playerContainerRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
  function jumpTo(ref: VerifiedReference) {
    jumpToTime(ref.timestamp_s);
  }
```

(d) In the JSX, replace the `FilterBar` + `ref-grid` block (the `<FilterBar .../>` element through the closing `</div>` of `ref-grid`) with a tab bar followed by tab panels:

```tsx
      {hasLyrics && (
        <div
          role="tablist"
          aria-label="Report sections"
          className="relative z-[1] flex gap-2 px-[clamp(32px,5vw,64px)] pt-4"
        >
          {([
            ["references", "References"],
            ["lyrics", `Lyrics × Visuals · ${lyricsLinks.length}`],
          ] as const).map(([key, label]) => {
            const on = activeTab === key;
            return (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={on}
                onClick={() => setActiveTab(key)}
                className={`inline-flex items-center gap-2 px-4 py-[7px] rounded-full border font-sans text-[12px] font-semibold uppercase tracking-uc cursor-pointer transition-[opacity,color,background] duration-200 ${
                  on
                    ? "bg-surface-strong border-hairline-strong text-ink"
                    : "bg-transparent border-hairline text-muted opacity-60 hover:opacity-100"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {(!hasLyrics || activeTab === "references") && (
        <>
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

          <div className="ref-grid relative z-[1] grid gap-[18px] py-8 px-[clamp(32px,5vw,64px)] grid-cols-[repeat(auto-fit,minmax(min(440px,100%),1fr))]">
            {filteredRefs.length === 0 ? (
              <div className="font-sans text-[12px] font-semibold uppercase tracking-uc text-muted col-span-full text-center p-12">
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
                    index={idx}
                    paletteHex={paletteHex}
                    paletteDescriptors={paletteDescriptors}
                    youtubeId={report.youtube_id}
                    onJump={() => jumpTo(ref)}
                  />
                );
              })
            )}
          </div>
        </>
      )}

      {hasLyrics && activeTab === "lyrics" && (
        <LyricsTimeline
          links={lyricsLinks}
          youtubeId={report.youtube_id}
          onSeek={jumpToTime}
        />
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && pnpm test ReportContent -- --run`
Expected: PASS (existing hash-seek tests + 2 new tab tests).

- [ ] **Step 5: Typecheck + lint**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/report/ReportContent.tsx frontend/components/report/ReportContent.test.tsx
git commit -m "feat(report): References / Lyrics × Visuals tab switch"
```

---

## Task 10: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update "How it works"**

In `README.md`, the pipeline is described as six stages. Add a seventh bullet after the **Enrich** bullet:

```markdown
7. **Lyrics × Visuals** — When the clip has captions, a final LLM pass pairs notable lyric lines (from YouTube auto-captions) with the on-screen frame at that moment and labels the connection (literal, motif, contrast, amplification). Surfaced in the report behind a "Lyrics × Visuals" tab. Disable with `LYRICS_LINKING=false`. Clips without captions simply omit the tab.
```

Also update the prose line that begins "Six-stage pipeline per clip:" to "Seven-stage pipeline per clip:".

- [ ] **Step 2: Update "Configuration"**

Add to the "Key knobs" list:

```markdown
- `LYRICS_LINKING` (default true) — set false to skip the lyrics↔visuals linking pass (and its extra LLM call).
- `MAX_LYRIC_LINKS` (default 10) — maximum lyric↔visual pairings surfaced.
```

- [ ] **Step 3: Update "Data retention"**

In the "Data retention" section, note the subtitle handling. Add after the `downloads/<youtube_id>.mp4` bullet:

```markdown
- Auto-caption files are downloaded next to the mp4, parsed, then deleted — no subtitle file is kept.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document the lyrics×visuals pipeline step and knobs"
```

---

## Final verification

- [ ] **Backend:** `cd backend && uv run pytest -q` → all pass.
- [ ] **Backend lint/types (if configured):** `cd backend && uv run ruff check app && uv run mypy app` → clean (match existing baseline; don't fix pre-existing unrelated findings).
- [ ] **Frontend:** `cd frontend && pnpm test -- --run` → all pass.
- [ ] **Frontend types:** `cd frontend && pnpm exec tsc --noEmit` → clean.
- [ ] **App builds:** `cd backend && uv run python -c "from app.main import _build_default_app; _build_default_app()"` → no error.
- [ ] (Optional, consumes NIM credits) Manual smoke: run a real analysis on a captioned music video and confirm the "Lyrics × Visuals" tab appears and seeking works.
```
