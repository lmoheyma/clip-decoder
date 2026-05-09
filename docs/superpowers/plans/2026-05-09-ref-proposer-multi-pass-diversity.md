# Ref Proposer Multi-Pass Diversity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `RefProposer.propose(...)` into a two-pass internal flow (general + complementary) so music videos surface 8-12 references with diversity across `work_type` (paintings, photographs, fashion editorials, etc.), not the current 0-5 films-only.

**Architecture:** The orchestrator's contract with `RefProposer` does not change. Inside `propose()`, pass 1 runs against a revised general prompt; pass 2 runs against a new complement prompt that receives the types pass 1 covered and is told to find candidates of *other* types. Results are merged with case-insensitive dedup on `(work_title, work_creator)`. Pass 2 failure is caught and degrades gracefully to pass-1-only.

**Tech Stack:** Python 3.12, pytest, pytest-asyncio, `AsyncMock` (matches existing test file), FastAPI/uvicorn behind, NIM client (httpx) — all already in place.

**Spec:** `docs/superpowers/specs/2026-05-09-ref-proposer-multi-pass-diversity-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `backend/app/pipeline/ref_proposer.py` | modify | `_call` helper, `_merge` helper, two-pass `propose()` |
| `backend/app/prompts/ref_proposer.md` | modify | Revised general prompt (reorder, examples, target N) |
| `backend/app/prompts/ref_proposer_complement.md` | create | New pass-2 prompt receiving `{types_covered}` |
| `backend/tests/unit/test_ref_proposer.py` | modify | Update existing tests + add 5 new tests |

The existing `test_ref_proposer.py` uses `AsyncMock` (not `respx`); this plan stays consistent with that pattern.

---

## Task 1: Extract `_call` helper (pure refactor)

**Goal:** Pull the "format template + call NIM + validate candidates" logic out of `propose()` into a private helper. No behavior change. Existing tests must still pass.

**Files:**
- Modify: `backend/app/pipeline/ref_proposer.py`
- Test: `backend/tests/unit/test_ref_proposer.py` (no changes — existing assertions are stable)

- [ ] **Step 1: Verify the existing tests pass before the refactor**

Run: `docker exec clip-decoder-backend-1 sh -lc 'cd /app && /app/.venv/bin/python -m pytest tests/unit/test_ref_proposer.py -v'`
Expected: 3 PASSED.

- [ ] **Step 2: Refactor — replace `propose` body with a `_call` helper**

Edit `backend/app/pipeline/ref_proposer.py`. Final file:

```python
from __future__ import annotations
import logging
from typing import Iterable
from pydantic import ValidationError
from app.models import FrameAnalysis, ReferenceCandidate
from app.nim.client import NimClient
from app.prompts.loader import load_prompt

logger = logging.getLogger(__name__)


def _escape_braces(s: str) -> str:
    """Escape literal braces so the string survives a `.format()` substitution."""
    return s.replace("{", "{{").replace("}", "}}")


def _format_frame_summaries(frames: Iterable[FrameAnalysis]) -> str:
    blocks = []
    for f in frames:
        blocks.append(
            f"[{f.frame_id} @ {f.timestamp_s:.1f}s] "
            f"composition={f.composition}; "
            f"palette={', '.join(f.palette)}; "
            f"camera={f.camera_move}; "
            f"setting={f.costume_setting}; "
            f"features={', '.join(f.distinctive_features)}; "
            f"raw={f.raw_description}"
        )
    return _escape_braces("\n".join(blocks))


class RefProposer:
    def __init__(self, nim_client: NimClient, model: str):
        self._nim = nim_client
        self._model = model
        self._template = load_prompt("ref_proposer")

    async def _call(self, template: str, ctx: dict) -> list[ReferenceCandidate]:
        prompt = template.format(**ctx)
        data = await self._nim.complete_text(
            model=self._model,
            messages=[{"role": "user", "content": prompt}],
            json_mode=True,
        )
        raw = data.get("candidates") or []
        out: list[ReferenceCandidate] = []
        for item in raw:
            try:
                out.append(ReferenceCandidate.model_validate(item))
            except ValidationError as e:
                logger.debug("dropped invalid candidate %r: %s", item, e)
                continue
        return out

    async def propose(
        self,
        *,
        title: str,
        channel: str,
        lyrics_text: str,
        frame_analyses: list[FrameAnalysis],
    ) -> list[ReferenceCandidate]:
        ctx = {
            "title": _escape_braces(title or "(unknown)"),
            "channel": _escape_braces(channel or "(unknown)"),
            "lyrics": _escape_braces(lyrics_text or "(none)"),
            "frame_summaries": _format_frame_summaries(frame_analyses),
        }
        return await self._call(self._template, ctx)
```

- [ ] **Step 3: Run existing tests to confirm refactor didn't change behavior**

Run: `docker exec clip-decoder-backend-1 sh -lc 'cd /app && /app/.venv/bin/python -m pytest tests/unit/test_ref_proposer.py -v'`
Expected: same 3 PASSED.

- [ ] **Step 4: Commit**

```bash
git add backend/app/pipeline/ref_proposer.py
git commit -m "refactor(backend): extract _call helper in RefProposer"
```

---

## Task 2: Add complement prompt template + load both in `__init__`

**Goal:** Create the new prompt file. Wire `RefProposer.__init__` to load both templates. No `propose()` changes yet — pass 1 still uses the general template only.

**Files:**
- Create: `backend/app/prompts/ref_proposer_complement.md`
- Modify: `backend/app/pipeline/ref_proposer.py:33-36` (`__init__`)
- Test: `backend/tests/unit/test_ref_proposer.py` (no changes this task)

- [ ] **Step 1: Create the complement prompt file**

Create `backend/app/prompts/ref_proposer_complement.md` with this exact content:

```markdown
You are a culturally literate critic. A previous pass has already proposed visual references for this music video, but only of certain types. Your job is to propose **additional named references** of types that the previous pass missed.

# Inputs

Title: {title}
Channel: {channel}
Lyrics excerpt (may be empty): {lyrics}

Types already proposed by the previous pass: {types_covered}

Frame summaries:
{frame_summaries}

# Rules

1. **Avoid types in `types_already_proposed`.** Focus on uncovered types from this list: painting, photograph, music_video, film, album_cover, fashion_editorial, ad_campaign, archival_footage, other. If `types_covered` is `(none)`, all types are open.
2. Each reference MUST name a specific work with title and creator. Vague claims ("70s horror cinema", "European art film", "minimalist photography") are forbidden — return nothing rather than something vague.
3. Each reference MUST cite at least three concrete visual elements from the frame summaries that support it.
4. Distinguish *visual* references (composition, palette, framing, costume, lighting) from generic mood. Do not propose a reference based purely on theme or lyric.
5. Aim for **3-5 candidates** of uncovered types when the frames support them. If no confident reference of a missing type exists, return an empty list.

# Output

Strict JSON. No markdown. No prose outside JSON.

```
{{
  "candidates": [
    {{
      "timestamp_s": <float>,
      "source_frame_id": "<shot_NN>",
      "work_title": "<exact title>",
      "work_creator": "<director / artist / photographer>",
      "work_year": <int or null>,
      "work_type": "painting" | "photograph" | "music_video" | "film" | "album_cover" | "fashion_editorial" | "ad_campaign" | "archival_footage" | "other",
      "reasoning": "<one sentence connecting at least three concrete visual elements>",
      "raw_confidence": <float 0..1>
    }}
  ]
}}
```
```

- [ ] **Step 2: Wire __init__ to load both templates**

In `backend/app/pipeline/ref_proposer.py`, replace the body of `__init__`:

```python
    def __init__(self, nim_client: NimClient, model: str):
        self._nim = nim_client
        self._model = model
        self._tpl_general = load_prompt("ref_proposer")
        self._tpl_complement = load_prompt("ref_proposer_complement")
```

And update `propose()` to use `self._tpl_general` (the previous attribute name `self._template` no longer exists):

```python
        return await self._call(self._tpl_general, ctx)
```

- [ ] **Step 3: Run tests to ensure nothing broke**

Run: `docker exec clip-decoder-backend-1 sh -lc 'cd /app && /app/.venv/bin/python -m pytest tests/unit/test_ref_proposer.py -v'`
Expected: 3 PASSED.

- [ ] **Step 4: Commit**

```bash
git add backend/app/prompts/ref_proposer_complement.md backend/app/pipeline/ref_proposer.py
git commit -m "feat(backend): add ref_proposer_complement prompt and load both templates"
```

---

## Task 3: Two-pass orchestration with `types_covered`

**Goal:** Make `propose()` call NIM twice — pass 1 with the general template, pass 2 with the complement template, with `types_covered` derived from pass 1's result.

**Files:**
- Modify: `backend/app/pipeline/ref_proposer.py` (`propose` body)
- Test: `backend/tests/unit/test_ref_proposer.py`

- [ ] **Step 1: Write the failing test for two-pass orchestration**

Append to `backend/tests/unit/test_ref_proposer.py`:

```python
async def test_propose_runs_two_passes_with_types_covered():
    nim = AsyncMock()
    # First call (pass 1) returns one film candidate; second call (pass 2)
    # should be told types_covered=film and return a painting candidate.
    nim.complete_text.side_effect = [
        {
            "candidates": [
                {
                    "timestamp_s": 12.5,
                    "source_frame_id": "shot_03",
                    "work_title": "The Shining",
                    "work_creator": "Stanley Kubrick",
                    "work_year": 1980,
                    "work_type": "film",
                    "reasoning": "symmetry + corridor + slow track",
                    "raw_confidence": 0.82,
                }
            ]
        },
        {
            "candidates": [
                {
                    "timestamp_s": 30.0,
                    "source_frame_id": "shot_07",
                    "work_title": "Liberty Leading the People",
                    "work_creator": "Eugène Delacroix",
                    "work_year": 1830,
                    "work_type": "painting",
                    "reasoning": "central raised figure + flag + smoke",
                    "raw_confidence": 0.7,
                }
            ]
        },
    ]
    rp = RefProposer(nim_client=nim, model="m")
    out = await rp.propose(
        title="x", channel="y", lyrics_text="",
        frame_analyses=[_fa("shot_03", 12.5), _fa("shot_07", 30.0)],
    )
    # Both calls happened, in order
    assert nim.complete_text.await_count == 2
    # Pass 2 received types_covered="film" inside its prompt
    pass2_kwargs = nim.complete_text.await_args_list[1].kwargs
    pass2_prompt = pass2_kwargs["messages"][0]["content"]
    assert "Types already proposed by the previous pass: film" in pass2_prompt
    # Both candidates surface
    titles = sorted(c.work_title for c in out)
    assert titles == ["Liberty Leading the People", "The Shining"]
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `docker exec clip-decoder-backend-1 sh -lc 'cd /app && /app/.venv/bin/python -m pytest tests/unit/test_ref_proposer.py::test_propose_runs_two_passes_with_types_covered -v'`
Expected: FAIL — `await_count == 1` (only pass 1 runs today) and the assertion on pass 2 prompt content errors.

- [ ] **Step 3: Implement two-pass `propose()`**

In `backend/app/pipeline/ref_proposer.py`, replace the `propose` method:

```python
    async def propose(
        self,
        *,
        title: str,
        channel: str,
        lyrics_text: str,
        frame_analyses: list[FrameAnalysis],
    ) -> list[ReferenceCandidate]:
        base_ctx = {
            "title": _escape_braces(title or "(unknown)"),
            "channel": _escape_braces(channel or "(unknown)"),
            "lyrics": _escape_braces(lyrics_text or "(none)"),
            "frame_summaries": _format_frame_summaries(frame_analyses),
        }
        pass1 = await self._call(self._tpl_general, base_ctx)

        types_covered = ", ".join(sorted({c.work_type for c in pass1})) or "(none)"
        pass2 = await self._call(
            self._tpl_complement,
            {**base_ctx, "types_covered": _escape_braces(types_covered)},
        )

        return pass1 + pass2
```

- [ ] **Step 4: Run all ref_proposer tests**

Run: `docker exec clip-decoder-backend-1 sh -lc 'cd /app && /app/.venv/bin/python -m pytest tests/unit/test_ref_proposer.py -v'`
Expected: 4 PASSED (3 existing + 1 new).

Note: existing tests stay green because `AsyncMock(return_value=X)` returns `X` for *every* call — pass 1 and pass 2 both yield the same payload, which after concat gives duplicates that the existing assertions don't trip on. (Dedup arrives in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/pipeline/ref_proposer.py backend/tests/unit/test_ref_proposer.py
git commit -m "feat(backend): two-pass ref proposer with types_covered exclusion"
```

---

## Task 4: Case-insensitive dedup on merge

**Goal:** Pass 2 may legitimately return a candidate that pass 1 already proposed (different framing, same work). Dedup on `(work_title, work_creator)` case-insensitive; pass 1 wins on collision.

**Files:**
- Modify: `backend/app/pipeline/ref_proposer.py` (add `_merge`, use it in `propose`)
- Test: `backend/tests/unit/test_ref_proposer.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/unit/test_ref_proposer.py`:

```python
async def test_merge_dedups_case_insensitive_pass1_wins():
    nim = AsyncMock()
    pass1_payload = {
        "candidates": [
            {
                "timestamp_s": 12.5,
                "source_frame_id": "shot_03",
                "work_title": "Suspiria",
                "work_creator": "Dario Argento",
                "work_year": 1977,
                "work_type": "film",
                "reasoning": "red light + symmetric corridor + ornate set",
                "raw_confidence": 0.85,
            }
        ]
    }
    # Pass 2 returns the same work in different case — must be dedup'd.
    pass2_payload = {
        "candidates": [
            {
                "timestamp_s": 50.0,
                "source_frame_id": "shot_10",
                "work_title": "SUSPIRIA",
                "work_creator": "dario argento",
                "work_year": 1977,
                "work_type": "film",
                "reasoning": "red palette + dance studio + neon",
                "raw_confidence": 0.4,
            }
        ]
    }
    nim.complete_text.side_effect = [pass1_payload, pass2_payload]
    rp = RefProposer(nim_client=nim, model="m")
    out = await rp.propose(
        title="x", channel="y", lyrics_text="",
        frame_analyses=[_fa("shot_03", 12.5)],
    )
    assert len(out) == 1
    # Pass 1 wins: original casing, original timestamp, original confidence.
    assert out[0].work_title == "Suspiria"
    assert out[0].work_creator == "Dario Argento"
    assert out[0].timestamp_s == 12.5
    assert out[0].raw_confidence == 0.85
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `docker exec clip-decoder-backend-1 sh -lc 'cd /app && /app/.venv/bin/python -m pytest tests/unit/test_ref_proposer.py::test_merge_dedups_case_insensitive_pass1_wins -v'`
Expected: FAIL — `len(out) == 2` (no dedup yet).

- [ ] **Step 3: Add `_merge` helper and use it**

In `backend/app/pipeline/ref_proposer.py`, add the helper at module level (below `_format_frame_summaries`):

```python
def _merge(
    pass1: list[ReferenceCandidate],
    pass2: list[ReferenceCandidate],
) -> list[ReferenceCandidate]:
    """Concatenate pass 1 + pass 2, dedup on case-insensitive
    (work_title, work_creator). Pass 1 entries always win on collision."""
    seen: set[tuple[str, str]] = set()
    out: list[ReferenceCandidate] = []
    for c in pass1 + pass2:
        key = (c.work_title.casefold(), c.work_creator.casefold())
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out
```

Replace the final line of `propose()` to use it:

```python
        return _merge(pass1, pass2)
```

- [ ] **Step 4: Run all ref_proposer tests**

Run: `docker exec clip-decoder-backend-1 sh -lc 'cd /app && /app/.venv/bin/python -m pytest tests/unit/test_ref_proposer.py -v'`
Expected: 5 PASSED.

Note: `test_proposes_named_candidates` continues to pass because the AsyncMock returns the same Shining payload twice; dedup collapses them to one — and that test asserts `len(out) == 1`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/pipeline/ref_proposer.py backend/tests/unit/test_ref_proposer.py
git commit -m "feat(backend): dedup ref-proposer pass 1+2 results on title+creator"
```

---

## Task 5: Graceful degradation when pass 2 fails

**Goal:** A NIM 5xx after retries (or any other unexpected exception in pass 2) must not lose pass 1's candidates. Wrap the pass 2 call in `try/except`.

**Files:**
- Modify: `backend/app/pipeline/ref_proposer.py` (`propose` body)
- Test: `backend/tests/unit/test_ref_proposer.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/unit/test_ref_proposer.py`:

```python
async def test_pass2_failure_returns_pass1_only(caplog):
    import httpx
    nim = AsyncMock()
    nim.complete_text.side_effect = [
        {
            "candidates": [
                {
                    "timestamp_s": 1.0,
                    "source_frame_id": "shot_00",
                    "work_title": "Solaris",
                    "work_creator": "Andrei Tarkovsky",
                    "work_year": 1972,
                    "work_type": "film",
                    "reasoning": "long static interior + reflective surface + somber palette",
                    "raw_confidence": 0.7,
                }
            ]
        },
        httpx.HTTPStatusError(
            "502", request=httpx.Request("POST", "https://x"),
            response=httpx.Response(502),
        ),
    ]
    rp = RefProposer(nim_client=nim, model="m")
    with caplog.at_level("WARNING", logger="app.pipeline.ref_proposer"):
        out = await rp.propose(
            title="x", channel="y", lyrics_text="",
            frame_analyses=[_fa("shot_00", 1.0)],
        )
    assert len(out) == 1
    assert out[0].work_title == "Solaris"
    assert any("pass 2 failed" in rec.message for rec in caplog.records)
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `docker exec clip-decoder-backend-1 sh -lc 'cd /app && /app/.venv/bin/python -m pytest tests/unit/test_ref_proposer.py::test_pass2_failure_returns_pass1_only -v'`
Expected: FAIL — exception propagates from `propose()`.

- [ ] **Step 3: Wrap pass 2 in try/except**

In `backend/app/pipeline/ref_proposer.py`, modify the `propose` body:

```python
    async def propose(
        self,
        *,
        title: str,
        channel: str,
        lyrics_text: str,
        frame_analyses: list[FrameAnalysis],
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

        return _merge(pass1, pass2)
```

Pass 1 failures still propagate (their behavior is unchanged from today: NIM client retries internally; if it ultimately raises, the orchestrator catches and emits `error`).

- [ ] **Step 4: Run all ref_proposer tests**

Run: `docker exec clip-decoder-backend-1 sh -lc 'cd /app && /app/.venv/bin/python -m pytest tests/unit/test_ref_proposer.py -v'`
Expected: 6 PASSED.

- [ ] **Step 5: Commit**

```bash
git add backend/app/pipeline/ref_proposer.py backend/tests/unit/test_ref_proposer.py
git commit -m "feat(backend): degrade gracefully when ref-proposer pass 2 fails"
```

---

## Task 6: Edge case — pass 1 empty triggers permissive pass 2

**Goal:** When pass 1 returns no candidates, `types_covered` is `(none)` and pass 2 still runs. This is intentional: hard clips (Pinkman case) get a second permissive attempt instead of a single empty result.

**Files:**
- Test: `backend/tests/unit/test_ref_proposer.py` (test only — implementation already covers this case)

- [ ] **Step 1: Write the test (it should pass given current implementation)**

Append to `backend/tests/unit/test_ref_proposer.py`:

```python
async def test_pass1_empty_pass2_still_runs_permissive():
    nim = AsyncMock()
    nim.complete_text.side_effect = [
        {"candidates": []},
        {
            "candidates": [
                {
                    "timestamp_s": 5.0,
                    "source_frame_id": "shot_02",
                    "work_title": "Trans-fixed",
                    "work_creator": "Chris Burden",
                    "work_year": 1974,
                    "work_type": "other",
                    "reasoning": "outstretched figure + cruciform pose + harsh ground",
                    "raw_confidence": 0.55,
                }
            ]
        },
    ]
    rp = RefProposer(nim_client=nim, model="m")
    out = await rp.propose(
        title="x", channel="y", lyrics_text="",
        frame_analyses=[_fa("shot_02", 5.0)],
    )
    assert nim.complete_text.await_count == 2
    pass2_prompt = nim.complete_text.await_args_list[1].kwargs["messages"][0]["content"]
    assert "Types already proposed by the previous pass: (none)" in pass2_prompt
    assert len(out) == 1
    assert out[0].work_title == "Trans-fixed"
```

- [ ] **Step 2: Run the test to verify it passes (no implementation change needed)**

Run: `docker exec clip-decoder-backend-1 sh -lc 'cd /app && /app/.venv/bin/python -m pytest tests/unit/test_ref_proposer.py::test_pass1_empty_pass2_still_runs_permissive -v'`
Expected: PASS.

If it fails, the most likely cause is the `types_covered` default — re-check the line `types_covered = ", ".join(sorted(...)) or "(none)"` in `propose()`.

- [ ] **Step 3: Run the full unit suite for the proposer**

Run: `docker exec clip-decoder-backend-1 sh -lc 'cd /app && /app/.venv/bin/python -m pytest tests/unit/test_ref_proposer.py -v'`
Expected: 7 PASSED.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/unit/test_ref_proposer.py
git commit -m "test(backend): cover ref-proposer permissive pass 2 on empty pass 1"
```

---

## Task 7: Revise the general prompt

**Goal:** Update `ref_proposer.md` with reordered type list (anchor away from `film`), explicit target of 5-8 candidates, diversity instruction, and three canonical non-film examples.

**Files:**
- Modify: `backend/app/prompts/ref_proposer.md`

- [ ] **Step 1: Replace the prompt content**

Replace the entire content of `backend/app/prompts/ref_proposer.md` with:

```markdown
You are a culturally literate critic. You receive structured descriptions of multiple frames from a single music video. Your job is to propose **named, verifiable visual references** the clip may be making — to specific paintings, photographs, films, other music videos, album covers, fashion editorials, or ad campaigns.

# Inputs

Title: {title}
Channel: {channel}
Lyrics excerpt (may be empty): {lyrics}

Frame summaries:
{frame_summaries}

# Rules

1. Each reference MUST name a specific work with title and creator. Vague claims ("70s horror cinema", "European art film", "minimalist photography") are forbidden — return nothing rather than something vague.
2. Each reference MUST cite at least three concrete visual elements from the frame summaries that support it.
3. Distinguish *visual* references (composition, palette, framing, costume, lighting) from generic mood. Do not propose a reference based purely on theme or lyric.
4. **Aim for 5-8 candidates when the frames support them.** Empty list is acceptable only when no concrete visual evidence exists.
5. **Prefer diversity of work_type when multiple plausible references exist** — music video clips quote paintings, photographs, fashion editorials, and album covers as much as films.

# Examples of valid candidates (across types)

- *Liberty Leading the People* by Eugène Delacroix (painting, 1830) — when frames show a central raised figure with a flag against smoke and fallen bodies.
- *Identical Twins, Roselle, NJ, 1967* by Diane Arbus (photograph) — when frames show two identical subjects in matching dress framed centrally and frontally.
- *Single Ladies (Put a Ring on It)* by Beyoncé / Jake Nava (music_video, 2008) — when frames show a black-and-white minimalist studio with three female dancers in synchronized choreography and locked hand positions.

# Output

Strict JSON. No markdown. No prose outside JSON.

```
{{
  "candidates": [
    {{
      "timestamp_s": <float>,
      "source_frame_id": "<shot_NN>",
      "work_title": "<exact title>",
      "work_creator": "<director / artist / photographer>",
      "work_year": <int or null>,
      "work_type": "painting" | "photograph" | "music_video" | "film" | "album_cover" | "fashion_editorial" | "ad_campaign" | "archival_footage" | "other",
      "reasoning": "<one sentence connecting at least three concrete visual elements>",
      "raw_confidence": <float 0..1>
    }}
  ]
}}
```
```

- [ ] **Step 2: Run the unit tests to make sure none break on the revised template**

The test fixtures use `AsyncMock` so the prompt content doesn't affect outcomes. But run anyway to ensure nothing in the prompt loader trips on syntax.

Run: `docker exec clip-decoder-backend-1 sh -lc 'cd /app && /app/.venv/bin/python -m pytest tests/unit/test_ref_proposer.py -v'`
Expected: 7 PASSED.

- [ ] **Step 3: Commit**

```bash
git add backend/app/prompts/ref_proposer.md
git commit -m "feat(backend): revise ref-proposer prompt for diversity (reorder, examples, target)"
```

---

## Task 8: Manual verification on the 5 known clips

**Goal:** Validate the pass criteria from the spec. This is a real end-to-end run; it spends NIM quota.

**Files:** None — runtime only.

- [ ] **Step 1: Reset DB**

```bash
docker exec clip-decoder-backend-1 sh -lc 'rm -f /app/data/clipdecoder.sqlite /app/data/clipdecoder.sqlite-wal /app/data/clipdecoder.sqlite-shm && rm -rf /app/data/frames/* /app/data/downloads/*'
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart backend
```

Wait until `curl -sS http://localhost:8000/api/health` returns 200.

- [ ] **Step 2: Re-analyze the 5 reference clips one by one**

For each id below, POST `/api/analyze` and let it complete (~3 minutes per clip). Watch the `crossref` step run twice as long as before (~10s).

- `Vl-GJaitlNs` — `https://www.youtube.com/watch?v=Vl-GJaitlNs` (PNL — A l'Ammoniaque)
- `dvgZkm1xWPE` — `https://www.youtube.com/watch?v=dvgZkm1xWPE` (Coldplay — Viva La Vida)
- `0KUf9U7e-VI` — `https://www.youtube.com/watch?v=0KUf9U7e-VI` (Moha MMZ — Pinkman)
- `URDPBG-vz3I` — `https://www.youtube.com/watch?v=URDPBG-vz3I` (S.Pri Noir — Ensemble)
- `4y4M-uTkdC0` — `https://www.youtube.com/watch?v=4y4M-uTkdC0` (MMZ — S Line)

```bash
for url in \
    "https://www.youtube.com/watch?v=Vl-GJaitlNs" \
    "https://www.youtube.com/watch?v=dvgZkm1xWPE" \
    "https://www.youtube.com/watch?v=0KUf9U7e-VI" \
    "https://www.youtube.com/watch?v=URDPBG-vz3I" \
    "https://www.youtube.com/watch?v=4y4M-uTkdC0"
do
    echo "=== $url ==="
    curl -sS -X POST -H 'Content-Type: application/json' \
        -d "{\"url\":\"$url\"}" http://localhost:8000/api/analyze
    echo
    # Poll for completion
    yid=$(echo "$url" | sed 's/.*v=//')
    while [ "$(curl -sS -o /dev/null -w '%{http_code}' http://localhost:8000/api/report/$yid)" != "200" ]; do
        sleep 10
    done
    echo "done: $yid"
done
```

- [ ] **Step 3: Inventory references with the same script used during brainstorming**

```bash
for id in Vl-GJaitlNs dvgZkm1xWPE 0KUf9U7e-VI URDPBG-vz3I 4y4M-uTkdC0; do
    curl -sS http://localhost:8000/api/report/$id 2>/dev/null | python3 -c "
import json, sys
from collections import Counter
r = json.load(sys.stdin)
print(f'=== {r[\"youtube_id\"]} :: {r[\"title\"][:60]}')
print(f'    refs: {len(r[\"references\"])}')
c = Counter((ref['verdict'], ref['work_type']) for ref in r['references'])
for (v, t), n in sorted(c.items()):
    print(f'    {v:12s} {t:20s} {n}')
"
done
```

- [ ] **Step 4: Check pass criteria**

Expected outcomes (per spec):

- [ ] Coldplay/Viva La Vida (`dvgZkm1xWPE`) — at least one candidate with `work_type == "painting"` (Delacroix's *Liberty Leading the People* is the canonical match).
- [ ] Pinkman (`0KUf9U7e-VI`) — at least one candidate of any type (vs. the previous run's 0 references).
- [ ] Mean total references across the 5 clips lands in 8-12.
- [ ] Across all 5 clips combined, at least 3 distinct `work_type` values appear.

If any pass criterion fails, do not chase a fix in this PR. Capture the failure in a follow-up issue noting the next escalation (the brainstorming's option C — type-aware fan-out — would be the next iteration).

- [ ] **Step 5: Final commit (if anything changed during verification)**

```bash
git status
# If clean: nothing to commit. If anything changed (e.g., a fix), commit it now.
```

---

## Self-Review

**Spec coverage:**
- Two-pass orchestration → Tasks 2, 3
- Type list reordered + diversity rules + examples → Task 7
- New complement prompt template → Task 2
- Sequential pass execution (pass 2 needs pass 1 types) → Task 3 (implementation order ensures this)
- Case-insensitive dedup, pass 1 wins → Task 4
- Pass 2 failure graceful degradation → Task 5
- Pass 1 empty → permissive pass 2 → Task 6
- Both passes empty → existing test (`test_empty_candidates_list_is_ok`) covers this; AsyncMock returns the same empty payload twice
- Verifier unchanged → no task (no change)
- Orchestrator unchanged → no task (no change)
- Frontend unchanged → no task (no change)
- Manual verification criteria → Task 8

All spec sections accounted for.

**Placeholder scan:** None. Every step has either explicit code, an exact command, or an exact file path with content.

**Type/name consistency:**
- `_tpl_general` and `_tpl_complement` (new attributes) used consistently from Task 2 onward.
- `_call(template, ctx)` signature consistent across Tasks 1, 3, 5.
- `_merge(pass1, pass2)` signature consistent in Tasks 4, 5.
- `types_covered` key consistent in tests (Tasks 3, 6) and prompt template (Task 2).
