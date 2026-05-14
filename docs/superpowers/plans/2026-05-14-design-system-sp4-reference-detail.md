# SP4 — Reference Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deep-linkable `/report/{id}/ref/{n}` page (frame 04 of the mockup), backed by a refactored verifier (3 reasoning fields) and a new `WikidataEnricher` that fills medium/institution/inception_year.

**Architecture:** Backend changes the post-vision tail of the pipeline (verifier outputs 3 reasoning fields; new WikidataEnricher fills artwork metadata after `verify_all`). Frontend adds a server-rendered Next.js route that composes four detail sub-components, plus a hash-based seek on the existing report page so the JUMP button round-trip works.

**Tech Stack:** Backend: Pydantic v2, httpx (Wikidata API), FastAPI, sse-starlette. Frontend: Next.js 15 App Router, React 19, TypeScript, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-13-design-system-migration-sp4-design.md`

---

## File map

**Backend — created:**
- `backend/app/pipeline/wikidata_enricher.py`
- `backend/tests/unit/test_wikidata_enricher.py`

**Backend — modified:**
- `backend/app/models.py` (drop `reasoning` from `ReferenceCandidate`; extend `VerifiedReference`)
- `backend/app/pipeline/verifier.py` (`_wiki_lookup` 3-tuple; reorder `_verify_one`; construct enriched output)
- `backend/app/prompts/verifier.md` (new output shape + `{wikipedia_summary}` placeholder)
- `backend/app/prompts/ref_proposer.md` + `backend/app/prompts/ref_proposer_complement.md` (drop `reasoning` from candidate JSON)
- `backend/app/pipeline/orchestrator.py` (inject enricher, emit enrich event, sort)
- `backend/app/settings.py` (3 new `wikidata_*` settings)
- `backend/app/main.py` (wire `WikidataEnricher`)
- `backend/tests/unit/test_verifier.py`, `test_ref_proposer.py`, `test_orchestrator.py` (adapt fixtures)

**Frontend — created:**
- `frontend/app/report/[id]/ref/[n]/page.tsx`
- `frontend/lib/api-server.ts`
- `frontend/components/report/detail/ReferenceDetail.tsx`
- `frontend/components/report/detail/DetailSlate.tsx`
- `frontend/components/report/detail/DetailTopRow.tsx`
- `frontend/components/report/detail/DetailCompare.tsx`
- `frontend/components/report/detail/DetailReasoning.tsx`
- `frontend/components/report/detail/DetailFrameAnalysis.tsx`
- `frontend/components/report/detail/DetailReasoning.test.tsx`
- `frontend/components/report/detail/DetailCompare.test.tsx`
- `frontend/components/report/detail/DetailNavigation.test.tsx`
- `frontend/components/report/ReportContent.test.tsx`

**Frontend — modified:**
- `frontend/lib/types.ts` (drop `reasoning`, add 6 new fields)
- `frontend/lib/reportStats.test.ts` (drop `reasoning` from fixture)
- `frontend/components/report/ReportContent.tsx` (hash-seek useEffect)
- `frontend/components/ReferenceCard.tsx` (Link wrap, anchors → buttons, cross_ref_reasoning)
- `frontend/app/globals.css` (SP4 CSS block)

---

## Phase A — Models + ref_proposer

### Task 1: Drop `reasoning` from `ReferenceCandidate` and ref_proposer prompts

**Files:**
- Modify: `backend/app/models.py:65`
- Modify: `backend/app/prompts/ref_proposer.md`
- Modify: `backend/app/prompts/ref_proposer_complement.md`
- Modify: `backend/tests/unit/test_ref_proposer.py`

- [ ] **Step 1: Adapt `test_ref_proposer.py` to remove `reasoning` from fixtures**

Replace every occurrence of the line `"reasoning": "..."` (or `"reasoning": "<...>"`) in the `nim.complete_text.return_value` fixtures with nothing. Concretely, the only field in the candidate JSON that has `reasoning` becomes:

```python
nim.complete_text.return_value = {
    "candidates": [
        {
            "timestamp_s": 12.5,
            "source_frame_id": "shot_03",
            "work_title": "The Shining",
            "work_creator": "Stanley Kubrick",
            "work_year": 1980,
            "work_type": "film",
            "raw_confidence": 0.82,
        }
    ]
}
```

(no `reasoning` line.) Apply this change to all three fixture blocks in `test_ref_proposer.py` (the propose, drops-empty-title, and two-passes tests).

- [ ] **Step 2: Run tests; they should still pass (Pydantic still validates `reasoning` required)**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_ref_proposer.py -q`
Expected: FAIL — Pydantic ValidationError "reasoning Field required". This proves the field is still required.

- [ ] **Step 3: Drop `reasoning` from `ReferenceCandidate`**

Edit `backend/app/models.py`. Remove the line:

```python
    reasoning: Annotated[str, Field(min_length=1)]
```

The `ReferenceCandidate` class becomes:

```python
class ReferenceCandidate(BaseModel):
    timestamp_s: Annotated[float, Field(ge=0.0)]
    source_frame_id: str
    work_title: Annotated[str, Field(min_length=1)]
    work_creator: Annotated[str, Field(min_length=1)]
    work_year: int | None = None
    work_type: str  # painting | photograph | music_video | film | album_cover | fashion_editorial | ad_campaign | archival_footage | other
    raw_confidence: Annotated[float, Field(ge=0.0, le=1.0)]
```

- [ ] **Step 4: Update the two ref_proposer prompt templates**

In `backend/app/prompts/ref_proposer.md`, delete the line:

```
      "reasoning": "<one sentence connecting at least three concrete visual elements>",
```

Same deletion in `backend/app/prompts/ref_proposer_complement.md` (line ~40, same string).

- [ ] **Step 5: Run tests; they should now pass**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_ref_proposer.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/prompts/ref_proposer.md backend/app/prompts/ref_proposer_complement.md backend/tests/unit/test_ref_proposer.py
git commit -m "refactor(backend): drop reasoning from ReferenceCandidate (moved to VerifiedReference 3-field split)"
```

---

### Task 2: Extend `VerifiedReference` with reasoning + Wikidata fields

**Files:**
- Modify: `backend/app/models.py:69`

- [ ] **Step 1: Edit the model**

In `backend/app/models.py`, replace the `VerifiedReference` class with:

```python
class VerifiedReference(ReferenceCandidate):
    verdict: Verdict
    final_confidence: Confidence
    supporting_elements: list[str]
    wikipedia_url: str | None = None
    wikipedia_thumbnail_url: str | None = None
    # Reasoning fields produced by the verifier prompt (Task 3+5).
    cross_ref_reasoning: str
    adversarial_reasoning: str
    wikipedia_reasoning: str
    # Wikidata enrichment fields filled by WikidataEnricher (Task 7-10).
    # All default to None when no Wikipedia URL was found, or Wikidata
    # had no claim for the field.
    medium: str | None = None
    institution: str | None = None
    inception_year: int | None = None
```

- [ ] **Step 2: Run the full backend suite — known failures**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit -q`
Expected: FAIL with multiple `ValidationError: cross_ref_reasoning Field required` / `adversarial_reasoning` / `wikipedia_reasoning`. This is fine — Task 3+5 will provide them. Note the failing tests for tracking.

- [ ] **Step 3: Commit**

```bash
git add backend/app/models.py
git commit -m "feat(backend): extend VerifiedReference with 3 reasoning fields + Wikidata fields"
```

---

## Phase B — Verifier refactor

### Task 3: Rewrite verifier prompt for 3 reasoning fields + wikipedia_summary placeholder

**Files:**
- Modify: `backend/app/prompts/verifier.md`

- [ ] **Step 1: Replace the prompt entirely**

Overwrite `backend/app/prompts/verifier.md` with:

```markdown
You are an adversarial reviewer. A previous model has proposed a reference. Your job is to either **defend** the claim with concrete supporting visual elements, or **reject** it — and to write three short editorial passes the user will read.

# The proposed claim

{candidate}

# The frame analysis it cites

{frame_analysis}

# Wikipedia summary for the proposed work (may be "(no Wikipedia article available)")

{wikipedia_summary}

# Rules

- If you can list **3 or more** specific visual elements from the frame analysis that genuinely support the claim, return verdict "keep".
- If you can list 1–2 supporting elements but the connection is plausible-but-thin, return "speculative".
- If the claim is unsupported by the frame analysis, or relies on theme/mood rather than concrete visual elements, return "reject".

# Reasoning passes

Produce three short paragraphs (1–3 sentences each):

1. `cross_ref_reasoning` — defend the match using concrete frame elements.
2. `adversarial_reasoning` — argue against the match. What would make this wrong? Cite competing references where natural.
3. `wikipedia_reasoning` — is the candidate consistent with the supplied Wikipedia summary (year, medium, creator, location)? If the summary is "(no Wikipedia article available)", write exactly: "No Wikipedia article available to cross-check."

# Output

Strict JSON. No markdown.

```
{{
  "verdict": "keep" | "speculative" | "reject",
  "supporting_elements": ["<concrete element>", "<concrete element>", "<concrete element>"],
  "cross_ref_reasoning": "<one-to-three sentences>",
  "adversarial_reasoning": "<one-to-three sentences>",
  "wikipedia_reasoning": "<one-to-three sentences, or the fallback line>"
}}
```
```

- [ ] **Step 2: Commit (prompt-only change)**

```bash
git add backend/app/prompts/verifier.md
git commit -m "refactor(backend): verifier prompt → 3 reasoning fields + {wikipedia_summary} placeholder"
```

---

### Task 4: `_wiki_lookup` returns the summary extract

**Files:**
- Modify: `backend/app/pipeline/verifier.py:40-61`
- Modify: `backend/tests/unit/test_verifier.py`

- [ ] **Step 1: Add a TDD test for the 3-tuple return shape**

Append this test to `backend/tests/unit/test_verifier.py`:

```python
@respx.mock
async def test_wiki_lookup_returns_summary_extract():
    nim = AsyncMock()
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(
        return_value=Response(
            200,
            json={
                "extract": "The Shining is a 1980 horror film directed by Stanley Kubrick.",
                "content_urls": {
                    "desktop": {"page": "https://en.wikipedia.org/wiki/The_Shining"}
                },
                "thumbnail": {"source": "https://upload.wikimedia.org/foo.jpg"},
            },
        )
    )
    page_url, thumb_url, summary = await v._wiki_lookup("The Shining")
    assert page_url == "https://en.wikipedia.org/wiki/The_Shining"
    assert thumb_url == "https://upload.wikimedia.org/foo.jpg"
    assert "The Shining is a 1980 horror film" in summary


@respx.mock
async def test_wiki_lookup_missing_page_returns_empty_summary():
    nim = AsyncMock()
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/Bogus"
    ).mock(return_value=Response(404))
    page_url, thumb_url, summary = await v._wiki_lookup("Bogus")
    assert page_url is None
    assert thumb_url is None
    assert summary == ""
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_verifier.py::test_wiki_lookup_returns_summary_extract backend/tests/unit/test_verifier.py::test_wiki_lookup_missing_page_returns_empty_summary -q`
Expected: FAIL — current `_wiki_lookup` returns a 2-tuple, so the unpack to 3 vars raises `ValueError: not enough values to unpack`.

- [ ] **Step 3: Update `_wiki_lookup`**

In `backend/app/pipeline/verifier.py`, replace the method:

```python
    async def _wiki_lookup(
        self, work_title: str
    ) -> tuple[str | None, str | None, str]:
        """Return (page_url, thumbnail_url, summary_extract).

        page_url/thumbnail_url are None when the article does not exist.
        summary_extract is "" on any failure or when Wikipedia returns no
        extract; that empty string is what we pass to the verifier prompt
        as the {wikipedia_summary} placeholder substrate.
        """
        slug = urllib.parse.quote(work_title.replace(" ", "_"))
        async with httpx.AsyncClient(
            timeout=10.0,
            headers={"User-Agent": WIKI_USER_AGENT},
        ) as http:
            try:
                r = await http.get(WIKI_SUMMARY_URL.format(slug=slug))
            except httpx.HTTPError:
                return None, None, ""
            if r.status_code != 200:
                return None, None, ""
            data = r.json()
            try:
                page_url = data["content_urls"]["desktop"]["page"]
            except (KeyError, TypeError):
                return None, None, ""
            thumb_url = (data.get("thumbnail") or {}).get("source")
            summary = data.get("extract", "") or ""
            return page_url, thumb_url, summary
```

- [ ] **Step 4: Run the new tests again — should now pass**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_verifier.py::test_wiki_lookup_returns_summary_extract backend/tests/unit/test_verifier.py::test_wiki_lookup_missing_page_returns_empty_summary -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Existing verifier tests will be broken — DO NOT FIX YET**

Other tests in this file unpack 2-tuples from `_verify_one`'s call to `_wiki_lookup`. They'll be fixed wholesale in Task 5. Confirm they fail:

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_verifier.py -q`
Expected: FAIL — `_verify_one` raises `ValueError: too many values to unpack`. Note the count.

- [ ] **Step 6: Commit**

```bash
git add backend/app/pipeline/verifier.py backend/tests/unit/test_verifier.py
git commit -m "refactor(backend): _wiki_lookup returns (page_url, thumb_url, summary_extract) triple"
```

---

### Task 5: Reorder `_verify_one` flow and produce new VerifiedReference shape

**Files:**
- Modify: `backend/app/pipeline/verifier.py:72-103`
- Modify: `backend/tests/unit/test_verifier.py` (rewrite all four existing tests)

- [ ] **Step 1: Rewrite the four existing verifier tests to the new flow + output shape**

The new contract: `_wiki_lookup` is called first; the LLM receives `{wikipedia_summary}` in its prompt; the LLM returns three reasoning fields. Replace the four existing tests in `backend/tests/unit/test_verifier.py` (`test_keep_with_wikipedia_match`, `test_keep_downgraded_to_speculative_when_wikipedia_missing`, `test_reject_returns_hidden`, `test_wikipedia_thumb_parsed_when_present`, `test_wikipedia_thumb_none_when_absent`) with these:

```python
@respx.mock
async def test_keep_with_wikipedia_match():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "keep",
        "supporting_elements": ["symmetry", "corridor", "tracking"],
        "cross_ref_reasoning": "Defends.",
        "adversarial_reasoning": "Counter.",
        "wikipedia_reasoning": "Consistent.",
    }
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(return_value=Response(200, json={
        "extract": "The Shining is a 1980 horror film.",
        "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/The_Shining"}},
    }))
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    result = await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    assert result.verdict == Verdict.KEEP
    assert result.final_confidence == Confidence.CONFIRMED
    assert "wikipedia.org" in (result.wikipedia_url or "")
    assert result.cross_ref_reasoning == "Defends."
    assert result.adversarial_reasoning == "Counter."
    assert result.wikipedia_reasoning == "Consistent."


@respx.mock
async def test_keep_downgraded_to_speculative_when_wikipedia_missing():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "keep",
        "supporting_elements": ["x", "y", "z"],
        "cross_ref_reasoning": "ok",
        "adversarial_reasoning": "thin",
        "wikipedia_reasoning": "No Wikipedia article available to cross-check.",
    }
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(return_value=Response(404))
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    result = await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    assert result.verdict == Verdict.KEEP
    assert result.final_confidence == Confidence.SPECULATIVE


@respx.mock
async def test_reject_returns_hidden():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "reject",
        "supporting_elements": [],
        "cross_ref_reasoning": "no support",
        "adversarial_reasoning": "the frame is something else",
        "wikipedia_reasoning": "irrelevant",
    }
    # respx still required because the verifier now always fetches Wikipedia first.
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(return_value=Response(404))
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    result = await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    assert result.verdict == Verdict.REJECT
    assert result.final_confidence == Confidence.HIDDEN


@respx.mock
async def test_wikipedia_thumb_parsed_when_present():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "keep",
        "supporting_elements": ["a", "b", "c"],
        "cross_ref_reasoning": "ok",
        "adversarial_reasoning": "ok",
        "wikipedia_reasoning": "ok",
    }
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(return_value=Response(200, json={
        "extract": "x",
        "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/The_Shining"}},
        "thumbnail": {"source": "https://upload.wikimedia.org/.../200px-shining.jpg"},
    }))
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    result = await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    assert result.wikipedia_thumbnail_url == "https://upload.wikimedia.org/.../200px-shining.jpg"


@respx.mock
async def test_wikipedia_thumb_none_when_absent():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "keep",
        "supporting_elements": ["a", "b", "c"],
        "cross_ref_reasoning": "ok",
        "adversarial_reasoning": "ok",
        "wikipedia_reasoning": "ok",
    }
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(return_value=Response(200, json={
        "extract": "x",
        "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/The_Shining"}},
    }))
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    result = await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    assert result.wikipedia_url is not None
    assert result.wikipedia_thumbnail_url is None


@respx.mock
async def test_verifier_passes_summary_into_prompt():
    """Regression: the wikipedia summary text should reach the LLM via
    the {wikipedia_summary} prompt placeholder."""
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "keep",
        "supporting_elements": ["a", "b", "c"],
        "cross_ref_reasoning": "ok",
        "adversarial_reasoning": "ok",
        "wikipedia_reasoning": "ok",
    }
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(return_value=Response(200, json={
        "extract": "Hotel horror film by Kubrick.",
        "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/The_Shining"}},
    }))
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    # complete_text is called with a list[messages]; the first user message's
    # content has the rendered prompt.
    call = nim.complete_text.call_args
    user_content = call.kwargs["messages"][0]["content"]
    assert "Hotel horror film by Kubrick." in user_content


@respx.mock
async def test_verifier_fallback_summary_when_wiki_missing():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "speculative",
        "supporting_elements": ["a"],
        "cross_ref_reasoning": "ok",
        "adversarial_reasoning": "ok",
        "wikipedia_reasoning": "No Wikipedia article available to cross-check.",
    }
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(return_value=Response(404))
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    call = nim.complete_text.call_args
    user_content = call.kwargs["messages"][0]["content"]
    assert "(no Wikipedia article available)" in user_content
```

- [ ] **Step 2: Run the rewritten tests, expect failure (the production code hasn't changed yet)**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_verifier.py -q`
Expected: FAIL — the LLM mock returns the new shape, but `_verify_one` still passes it to a 2-tuple-expecting `_wiki_lookup` (already adapted in Task 4) AND constructs `VerifiedReference` without the three new reasoning fields. Multiple ValidationErrors.

- [ ] **Step 3: Rewrite `_verify_one`**

In `backend/app/pipeline/verifier.py`, replace the method:

```python
    async def _verify_one(
        self,
        candidate: ReferenceCandidate,
        frame_index: dict[str, FrameAnalysis],
    ) -> VerifiedReference:
        async with self._sem:
            # Wikipedia lookup FIRST so the LLM can ground wikipedia_reasoning
            # in the summary. Cheap (HTTP-cached by Wikipedia's CDN) and worth
            # running unconditionally — even for candidates the model will
            # ultimately reject, the summary informs the adversarial pass.
            if self._wiki:
                wiki_url, wiki_thumb, summary = await self._wiki_lookup(
                    candidate.work_title
                )
            else:
                wiki_url, wiki_thumb, summary = None, None, ""

            wiki_blob = summary if summary else "(no Wikipedia article available)"

            fa = frame_index.get(candidate.source_frame_id)
            fa_blob = fa.model_dump_json() if fa else "{}"
            cand_blob = candidate.model_dump_json()
            prompt = self._template.format(
                candidate=cand_blob,
                frame_analysis=fa_blob,
                wikipedia_summary=wiki_blob,
            )
            data = await self._nim.complete_text(
                model=self._model,
                messages=[{"role": "user", "content": prompt}],
                json_mode=True,
            )

        verdict = Verdict(str(data.get("verdict", "reject")).lower())
        supporting = [str(x) for x in (data.get("supporting_elements") or [])]
        bucket = self._bucket(verdict, wiki_url)
        return VerifiedReference(
            **candidate.model_dump(),
            verdict=verdict,
            final_confidence=bucket,
            supporting_elements=supporting,
            wikipedia_url=wiki_url,
            wikipedia_thumbnail_url=wiki_thumb,
            cross_ref_reasoning=str(data.get("cross_ref_reasoning", "")),
            adversarial_reasoning=str(data.get("adversarial_reasoning", "")),
            wikipedia_reasoning=str(data.get("wikipedia_reasoning", "")),
        )
```

Note: the `_bucket` helper unchanged. The `if self._wiki and verdict is not Verdict.REJECT:` gate that used to wrap the lookup is gone.

- [ ] **Step 4: Run verifier tests — should now pass**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_verifier.py -q`
Expected: PASS (all 7 tests in the file).

- [ ] **Step 5: Commit**

```bash
git add backend/app/pipeline/verifier.py backend/tests/unit/test_verifier.py
git commit -m "refactor(backend): verifier fetches wiki summary first, emits 3 reasoning fields"
```

---

## Phase C — Wikidata enricher

### Task 6: Add Wikidata settings

**Files:**
- Modify: `backend/app/settings.py`

- [ ] **Step 1: Add the three settings**

In `backend/app/settings.py`, after the `wikipedia_verification: bool = True` line, add:

```python
    # Wikidata enrichment for VerifiedReference (medium/institution/inception_year).
    # Independent of wikipedia_verification: a run can have Wikipedia URL/thumb
    # lookup enabled while skipping Wikidata calls. Wikidata is only consulted
    # when the verifier has already produced a wikipedia_url.
    wikidata_enrichment: bool = True
    wikidata_concurrency: int = 4
    wikidata_timeout_s: float = 10.0
```

- [ ] **Step 2: Smoke-import to confirm the module still parses**

Run: `docker exec clip-decoder-backend-1 python -c "from app.settings import settings; print(settings.wikidata_concurrency)"`
Expected: prints `4`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/settings.py
git commit -m "feat(backend): add wikidata_enrichment + concurrency + timeout settings"
```

---

### Task 7: WikidataEnricher pure helpers (TDD)

**Files:**
- Create: `backend/app/pipeline/wikidata_enricher.py`
- Create: `backend/tests/unit/test_wikidata_enricher.py`

This task introduces the module skeleton with four pure helpers (`_extract_slug`, `_select_claim`, `_parse_inception_year`, `_resolve_labels`). The async network helpers come in the next task.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_wikidata_enricher.py`:

```python
from app.pipeline.wikidata_enricher import (
    _extract_slug,
    _select_claim,
    _parse_inception_year,
)


def test_extract_slug_from_wikipedia_url():
    assert (
        _extract_slug("https://en.wikipedia.org/wiki/Le_faux_miroir")
        == "Le_faux_miroir"
    )
    assert (
        _extract_slug("https://en.wikipedia.org/wiki/The_Shining")
        == "The_Shining"
    )
    # Trailing slash and query string
    assert (
        _extract_slug("https://en.wikipedia.org/wiki/Foo/")
        == "Foo"
    )
    assert (
        _extract_slug("https://en.wikipedia.org/wiki/Foo?bar=baz")
        == "Foo"
    )


def test_extract_slug_returns_none_for_non_wiki_url():
    assert _extract_slug("https://example.com/foo") is None
    assert _extract_slug("") is None
    assert _extract_slug(None) is None  # type: ignore[arg-type]


def test_select_claim_prefers_preferred_rank():
    claims = [
        {"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q1"}}}},
        {"rank": "preferred", "mainsnak": {"datavalue": {"value": {"id": "Q2"}}}},
        {"rank": "deprecated", "mainsnak": {"datavalue": {"value": {"id": "Q3"}}}},
    ]
    assert _select_claim(claims) == claims[1]


def test_select_claim_first_normal_when_no_preferred():
    claims = [
        {"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q1"}}}},
        {"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q2"}}}},
    ]
    assert _select_claim(claims) == claims[0]


def test_select_claim_skips_deprecated():
    claims = [
        {"rank": "deprecated", "mainsnak": {"datavalue": {"value": {"id": "Q1"}}}},
        {"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q2"}}}},
    ]
    assert _select_claim(claims) == claims[1]


def test_select_claim_returns_none_for_empty_or_all_deprecated():
    assert _select_claim([]) is None
    assert (
        _select_claim(
            [{"rank": "deprecated", "mainsnak": {"datavalue": {"value": {"id": "Q1"}}}}]
        )
        is None
    )


def test_parse_inception_year_positive():
    assert _parse_inception_year("+1929-00-00T00:00:00Z") == 1929
    assert _parse_inception_year("+0001-00-00T00:00:00Z") == 1


def test_parse_inception_year_negative_bc():
    assert _parse_inception_year("-0500-00-00T00:00:00Z") == -500


def test_parse_inception_year_malformed_returns_none():
    assert _parse_inception_year("bogus") is None
    assert _parse_inception_year("") is None
    assert _parse_inception_year(None) is None  # type: ignore[arg-type]
```

- [ ] **Step 2: Run tests to confirm they fail (module not yet created)**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_wikidata_enricher.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.pipeline.wikidata_enricher'`.

- [ ] **Step 3: Create the module skeleton**

Create `backend/app/pipeline/wikidata_enricher.py`:

```python
from __future__ import annotations
import logging
import re
from typing import Any
from urllib.parse import urlparse, unquote

logger = logging.getLogger(__name__)


# Rank ordering for Wikidata statements when multiple statements share a
# property. "preferred" wins, then "normal" (in JSON order), then we ignore
# "deprecated". This matches Wikidata's recommended client-side selection.
_RANK_ORDER = {"preferred": 0, "normal": 1, "deprecated": 2}


def _extract_slug(wiki_url: str | None) -> str | None:
    """Return the URL-decoded slug from a Wikipedia URL.

    `https://en.wikipedia.org/wiki/Le_faux_miroir` -> `Le_faux_miroir`.
    Returns None for non-Wikipedia URLs or empty input.
    """
    if not wiki_url:
        return None
    try:
        parsed = urlparse(wiki_url)
    except ValueError:
        return None
    if "wikipedia.org" not in parsed.netloc:
        return None
    # path is /wiki/<slug>(/...?...)
    m = re.match(r"^/wiki/([^/?#]+)", parsed.path)
    if not m:
        return None
    return unquote(m.group(1))


def _select_claim(claims: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick the most-preferred non-deprecated claim from a property's list.

    Preference order: preferred > normal > (deprecated dropped).
    Within the same rank, first-by-JSON-order wins.
    """
    eligible = [c for c in claims if c.get("rank", "normal") != "deprecated"]
    if not eligible:
        return None
    eligible.sort(key=lambda c: _RANK_ORDER.get(c.get("rank", "normal"), 1))
    return eligible[0]


def _parse_inception_year(time_value: str | None) -> int | None:
    """Parse the year from a Wikidata `time` claim value.

    Wikidata's date format is `[+-]YYYY-MM-DDTHH:MM:SSZ` with leading
    `+` for AD and `-` for BC. Returns the year as a signed int.
    """
    if not time_value:
        return None
    m = re.match(r"^([+-])(\d{1,4})-", time_value)
    if not m:
        return None
    sign = -1 if m.group(1) == "-" else 1
    return sign * int(m.group(2))
```

- [ ] **Step 4: Run tests — should pass**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_wikidata_enricher.py -q`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/pipeline/wikidata_enricher.py backend/tests/unit/test_wikidata_enricher.py
git commit -m "feat(backend): WikidataEnricher pure helpers (slug, claim selection, year parse)"
```

---

### Task 8: WikidataEnricher network calls (TDD with respx)

**Files:**
- Modify: `backend/app/pipeline/wikidata_enricher.py`
- Modify: `backend/tests/unit/test_wikidata_enricher.py`

This task adds the three async fetchers and the per-ref `_enrich_one` that composes them.

- [ ] **Step 1: Add the failing tests**

Append to `backend/tests/unit/test_wikidata_enricher.py`:

```python
import respx
from httpx import Response
from app.pipeline.wikidata_enricher import WikidataEnricher
from app.models import VerifiedReference, Verdict, Confidence


def _ref(wiki_url: str | None = "https://en.wikipedia.org/wiki/Le_faux_miroir") -> VerifiedReference:
    return VerifiedReference(
        timestamp_s=42.0,
        source_frame_id="shot_03",
        work_title="Le faux miroir",
        work_creator="René Magritte",
        work_year=1929,
        work_type="painting",
        raw_confidence=0.9,
        verdict=Verdict.KEEP,
        final_confidence=Confidence.CONFIRMED,
        supporting_elements=["eye", "sky", "cumulus"],
        wikipedia_url=wiki_url,
        wikipedia_thumbnail_url=None,
        cross_ref_reasoning="x",
        adversarial_reasoning="x",
        wikipedia_reasoning="x",
    )


@respx.mock
async def test_enriches_with_medium_and_institution():
    # 1) pageprops -> wikibase_item
    respx.get(
        "https://en.wikipedia.org/w/api.php"
    ).mock(return_value=Response(200, json={
        "query": {"pages": {"123": {"pageprops": {"wikibase_item": "Q123"}}}}
    }))
    # 2) EntityData
    respx.get(
        "https://www.wikidata.org/wiki/Special:EntityData/Q123.json"
    ).mock(return_value=Response(200, json={
        "entities": {"Q123": {"claims": {
            "P186": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q300"}}}}],
            "P276": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q400"}}}}],
            "P571": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"time": "+1929-00-00T00:00:00Z"}}}}],
        }}}
    }))
    # 3) wbgetentities labels for Q300, Q400
    respx.get(
        "https://www.wikidata.org/w/api.php"
    ).mock(return_value=Response(200, json={
        "entities": {
            "Q300": {"labels": {"en": {"value": "oil on canvas"}}},
            "Q400": {"labels": {"en": {"value": "Museum of Modern Art"}}},
        }
    }))
    enricher = WikidataEnricher(concurrency=2)
    out = await enricher.enrich([_ref()])
    assert len(out) == 1
    assert out[0].medium == "oil on canvas"
    assert out[0].institution == "Museum of Modern Art"
    assert out[0].inception_year == 1929


@respx.mock
async def test_no_wikibase_item():
    respx.get("https://en.wikipedia.org/w/api.php").mock(
        return_value=Response(200, json={
            "query": {"pages": {"123": {}}}  # no pageprops at all
        })
    )
    enricher = WikidataEnricher(concurrency=2)
    out = await enricher.enrich([_ref()])
    assert out[0].medium is None
    assert out[0].institution is None
    assert out[0].inception_year is None


@respx.mock
async def test_wikidata_returns_404_for_qid():
    respx.get("https://en.wikipedia.org/w/api.php").mock(
        return_value=Response(200, json={
            "query": {"pages": {"123": {"pageprops": {"wikibase_item": "Q999"}}}}
        })
    )
    respx.get(
        "https://www.wikidata.org/wiki/Special:EntityData/Q999.json"
    ).mock(return_value=Response(404))
    enricher = WikidataEnricher(concurrency=2)
    out = await enricher.enrich([_ref()])
    assert out[0].medium is None
    assert out[0].institution is None
    assert out[0].inception_year is None


@respx.mock
async def test_partial_claims_present():
    respx.get("https://en.wikipedia.org/w/api.php").mock(
        side_effect=[
            Response(200, json={
                "query": {"pages": {"123": {"pageprops": {"wikibase_item": "Q123"}}}}
            }),
            # wbgetentities for labels — no QIDs to resolve here
            Response(200, json={"entities": {}}),
        ]
    )
    respx.get(
        "https://www.wikidata.org/wiki/Special:EntityData/Q123.json"
    ).mock(return_value=Response(200, json={
        "entities": {"Q123": {"claims": {
            "P571": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"time": "+1880-00-00T00:00:00Z"}}}}],
        }}}
    }))
    enricher = WikidataEnricher(concurrency=2)
    out = await enricher.enrich([_ref()])
    assert out[0].inception_year == 1880
    assert out[0].medium is None
    assert out[0].institution is None


@respx.mock
async def test_skips_refs_without_wikipedia_url():
    # No respx route — if any HTTP call were made, respx would raise.
    enricher = WikidataEnricher(concurrency=2)
    out = await enricher.enrich([_ref(wiki_url=None)])
    assert out[0].medium is None
    assert out[0].institution is None
    assert out[0].inception_year is None
```

- [ ] **Step 2: Run tests to confirm they fail (the class doesn't exist yet)**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_wikidata_enricher.py -q`
Expected: FAIL — `ImportError: cannot import name 'WikidataEnricher'` for the new tests; the pure-helper tests still pass.

- [ ] **Step 3: Implement the network helpers + enrich loop**

Append to `backend/app/pipeline/wikidata_enricher.py`:

```python
import asyncio
from typing import Awaitable, Callable
import httpx
from app.models import VerifiedReference
from app.pipeline.verifier import WIKI_USER_AGENT


_WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
_WIKIDATA_ENTITY = "https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
_WIKIDATA_API = "https://www.wikidata.org/w/api.php"


class WikidataEnricher:
    """Add medium / institution / inception_year to verified references
    that have a `wikipedia_url`. Independent of the verifier; the
    orchestrator calls `enrich(...)` after `verify_all`.

    Resilient: a per-ref failure (HTTP, parse, missing claims) returns
    the ref with the new fields left as None — never raises out of
    `enrich`. The whole step is wrapped in a try/except by the
    orchestrator as a final safety net.
    """

    def __init__(self, *, concurrency: int = 4, timeout_s: float = 10.0):
        self._sem = asyncio.Semaphore(concurrency)
        self._timeout = timeout_s

    async def enrich(
        self,
        refs: list[VerifiedReference],
        on_progress: Callable[[str, float], Awaitable[None]] | None = None,
    ) -> list[VerifiedReference]:
        total = len(refs)
        completed = 0
        lock = asyncio.Lock()

        async def _wrapped(idx: int, r: VerifiedReference) -> VerifiedReference:
            nonlocal completed
            try:
                out = await self._enrich_one(r)
            except Exception as e:  # noqa: BLE001 — final safety net per spec
                logger.warning(
                    "wikidata enrichment failed for %r: %s",
                    r.work_title, e,
                )
                out = r
            async with lock:
                completed += 1
                if on_progress:
                    band_start, band_end = 0.95, 0.99
                    p = band_start + (completed / max(total, 1)) * (band_end - band_start)
                    await on_progress(
                        f"Enriched {completed}/{total} · {r.work_title} → "
                        f"{out.medium or '—'}",
                        p,
                    )
            return out

        if not refs:
            return refs
        async with httpx.AsyncClient(
            timeout=self._timeout,
            headers={"User-Agent": WIKI_USER_AGENT},
        ) as http:
            self._http = http  # noqa: SLF001 — share the client for the run
            results = await asyncio.gather(
                *(self._sem_wrap(_wrapped(i, r)) for i, r in enumerate(refs)),
                return_exceptions=False,
            )
            self._http = None  # type: ignore[assignment]
        return list(results)

    async def _sem_wrap(self, coro: Awaitable[VerifiedReference]) -> VerifiedReference:
        async with self._sem:
            return await coro

    async def _enrich_one(self, r: VerifiedReference) -> VerifiedReference:
        slug = _extract_slug(r.wikipedia_url)
        if slug is None:
            return r
        qid = await self._fetch_qid(slug)
        if qid is None:
            return r
        claims = await self._fetch_claims(qid)
        if claims is None:
            return r
        medium_qid = self._claim_qid(claims.get("P186", []))
        institution_qid = self._claim_qid(claims.get("P276", []))
        inception = self._claim_inception(claims.get("P571", []))
        labels_to_resolve = [q for q in (medium_qid, institution_qid) if q]
        labels = await self._resolve_labels(labels_to_resolve) if labels_to_resolve else {}
        return r.model_copy(update={
            "medium": labels.get(medium_qid) if medium_qid else None,
            "institution": labels.get(institution_qid) if institution_qid else None,
            "inception_year": inception,
        })

    async def _fetch_qid(self, slug: str) -> str | None:
        r = await self._http.get(_WIKIPEDIA_API, params={
            "action": "query",
            "prop": "pageprops",
            "ppprop": "wikibase_item",
            "format": "json",
            "titles": slug,
        })
        if r.status_code != 200:
            return None
        pages = (r.json().get("query") or {}).get("pages") or {}
        # pages is a dict keyed by page id; we want the first non-missing entry.
        for page in pages.values():
            qid = (page.get("pageprops") or {}).get("wikibase_item")
            if qid:
                return qid
        return None

    async def _fetch_claims(self, qid: str) -> dict[str, list] | None:
        r = await self._http.get(_WIKIDATA_ENTITY.format(qid=qid))
        if r.status_code != 200:
            return None
        entities = (r.json().get("entities") or {})
        entity = entities.get(qid) or {}
        return entity.get("claims") or {}

    def _claim_qid(self, claim_list: list) -> str | None:
        c = _select_claim(claim_list)
        if c is None:
            return None
        try:
            return c["mainsnak"]["datavalue"]["value"]["id"]
        except (KeyError, TypeError):
            return None

    def _claim_inception(self, claim_list: list) -> int | None:
        c = _select_claim(claim_list)
        if c is None:
            return None
        try:
            time_value = c["mainsnak"]["datavalue"]["value"]["time"]
        except (KeyError, TypeError):
            return None
        return _parse_inception_year(time_value)

    async def _resolve_labels(self, qids: list[str]) -> dict[str, str]:
        if not qids:
            return {}
        r = await self._http.get(_WIKIDATA_API, params={
            "action": "wbgetentities",
            "ids": "|".join(qids),
            "props": "labels",
            "languages": "en",
            "format": "json",
        })
        if r.status_code != 200:
            return {}
        out: dict[str, str] = {}
        entities = (r.json().get("entities") or {})
        for qid, entity in entities.items():
            label = ((entity.get("labels") or {}).get("en") or {}).get("value")
            if label:
                out[qid] = label
        return out
```

- [ ] **Step 4: Run all enricher tests — should pass**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_wikidata_enricher.py -q`
Expected: PASS (14 tests — 9 pure-helper + 5 network).

- [ ] **Step 5: Commit**

```bash
git add backend/app/pipeline/wikidata_enricher.py backend/tests/unit/test_wikidata_enricher.py
git commit -m "feat(backend): WikidataEnricher fetches medium/institution/inception via Wikidata"
```

---

### Task 9: One-fails-others-succeed test (concurrency safety)

**Files:**
- Modify: `backend/tests/unit/test_wikidata_enricher.py`

- [ ] **Step 1: Add the test**

Append to `backend/tests/unit/test_wikidata_enricher.py`:

```python
@respx.mock
async def test_one_ref_fails_others_succeed():
    # Three refs, three pageprops calls. Second one returns a 500.
    page_responses = [
        Response(200, json={"query": {"pages": {"1": {"pageprops": {"wikibase_item": "Q1"}}}}}),
        Response(500),
        Response(200, json={"query": {"pages": {"3": {"pageprops": {"wikibase_item": "Q3"}}}}}),
    ]
    respx.get("https://en.wikipedia.org/w/api.php").mock(side_effect=page_responses + [
        # wbgetentities for Q1's claim QIDs and Q3's claim QIDs (both same dummy Q300)
        Response(200, json={"entities": {"Q300": {"labels": {"en": {"value": "oil on canvas"}}}}}),
        Response(200, json={"entities": {"Q300": {"labels": {"en": {"value": "oil on canvas"}}}}}),
    ])
    respx.get(
        "https://www.wikidata.org/wiki/Special:EntityData/Q1.json"
    ).mock(return_value=Response(200, json={
        "entities": {"Q1": {"claims": {
            "P186": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q300"}}}}],
        }}}
    }))
    respx.get(
        "https://www.wikidata.org/wiki/Special:EntityData/Q3.json"
    ).mock(return_value=Response(200, json={
        "entities": {"Q3": {"claims": {
            "P186": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q300"}}}}],
        }}}
    }))
    refs = [
        _ref(wiki_url="https://en.wikipedia.org/wiki/Foo"),
        _ref(wiki_url="https://en.wikipedia.org/wiki/Bar"),
        _ref(wiki_url="https://en.wikipedia.org/wiki/Baz"),
    ]
    # Use concurrency=1 to force a deterministic order matching page_responses.
    enricher = WikidataEnricher(concurrency=1)
    out = await enricher.enrich(refs)
    assert len(out) == 3
    assert out[0].medium == "oil on canvas"
    assert out[1].medium is None  # the 500
    assert out[2].medium == "oil on canvas"
```

- [ ] **Step 2: Run — should pass on the existing implementation**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_wikidata_enricher.py::test_one_ref_fails_others_succeed -q`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/unit/test_wikidata_enricher.py
git commit -m "test(backend): one ref's enrichment failure does not abort the rest"
```

---

## Phase D — Orchestrator integration

### Task 10: Wire WikidataEnricher into the orchestrator

**Files:**
- Modify: `backend/app/pipeline/orchestrator.py`
- Modify: `backend/tests/unit/test_orchestrator.py`

- [ ] **Step 1: Add the failing test**

Append to `backend/tests/unit/test_orchestrator.py`:

```python
from app.pipeline.wikidata_enricher import WikidataEnricher


async def test_orchestrator_emits_enrich_step_and_uses_enriched_refs(tmp_path: Path):
    keyframes, fa_results, candidates = _default_fixtures(tmp_path)

    verifier = AsyncMock()
    verified_ref = VerifiedReference(
        **candidates[0].model_dump(),
        verdict=Verdict.KEEP,
        final_confidence=Confidence.CONFIRMED,
        supporting_elements=["a"],
        wikipedia_url="https://en.wikipedia.org/wiki/The_Shining",
        cross_ref_reasoning="cr",
        adversarial_reasoning="ad",
        wikipedia_reasoning="wk",
    )
    verifier.verify_all.return_value = [verified_ref]

    enricher = AsyncMock()
    enricher.enrich.return_value = [
        verified_ref.model_copy(update={
            "medium": "celluloid",
            "institution": "Warner Bros.",
            "inception_year": 1980,
        })
    ]

    db_mock = AsyncMock()
    db_mock.get_status = AsyncMock(return_value=AnalysisStatus.DONE)
    db_mock.save_report = AsyncMock()
    db_mock.set_status = AsyncMock()
    bus = EventBus()

    ingestor = MagicMock()
    ingestor.ingest.return_value = IngestResult(
        youtube_id="abc", video_path=tmp_path / "v.mp4",
        title="t", channel="c", duration_s=10.0, captions=[],
    )
    sampler = MagicMock()
    sampler.sample.return_value = keyframes

    async def _analyze(kfs, on_frame=None):
        return fa_results
    frame_analyzer = MagicMock()
    frame_analyzer.analyze = _analyze

    async def _propose(*, title, channel, lyrics_text, frame_analyses, on_candidate=None):
        return candidates
    proposer = MagicMock()
    proposer.propose = _propose

    orch = Orchestrator(
        db=db_mock, bus=bus,
        ingestor=ingestor, sampler=sampler,
        frame_analyzer=frame_analyzer,
        ref_proposer=proposer, verifier=verifier,
        enricher=enricher,
    )

    received: list = []
    async def collect():
        async for ev in bus.subscribe("abc"):
            received.append(ev)
            if ev.step == "done":
                break

    consumer = asyncio.create_task(collect())
    await orch.run("https://www.youtube.com/watch?v=abc")
    await asyncio.wait_for(consumer, timeout=2.0)

    verify_msgs = [e.message for e in received if e.step == "verify"]
    assert any("Enriching" in m for m in verify_msgs), (
        f"No 'Enriching' verify event found: {verify_msgs}"
    )

    saved_report = db_mock.save_report.call_args.args[0]
    assert saved_report.references[0].medium == "celluloid"
    assert saved_report.references[0].institution == "Warner Bros."
    assert saved_report.references[0].inception_year == 1980


async def test_orchestrator_continues_when_enricher_raises(tmp_path: Path):
    keyframes, fa_results, candidates = _default_fixtures(tmp_path)
    verifier = AsyncMock()
    verified_ref = VerifiedReference(
        **candidates[0].model_dump(),
        verdict=Verdict.KEEP,
        final_confidence=Confidence.CONFIRMED,
        supporting_elements=["a"],
        wikipedia_url=None,
        cross_ref_reasoning="cr",
        adversarial_reasoning="ad",
        wikipedia_reasoning="wk",
    )
    verifier.verify_all.return_value = [verified_ref]
    enricher = AsyncMock()
    enricher.enrich.side_effect = RuntimeError("wikidata down")

    db_mock = AsyncMock()
    db_mock.get_status = AsyncMock(return_value=AnalysisStatus.DONE)
    db_mock.save_report = AsyncMock()
    db_mock.set_status = AsyncMock()
    bus = EventBus()
    ingestor = MagicMock()
    ingestor.ingest.return_value = IngestResult(
        youtube_id="abc", video_path=tmp_path / "v.mp4",
        title="t", channel="c", duration_s=10.0, captions=[],
    )
    sampler = MagicMock(); sampler.sample.return_value = keyframes
    async def _analyze(kfs, on_frame=None): return fa_results
    frame_analyzer = MagicMock(); frame_analyzer.analyze = _analyze
    async def _propose(**kw): return candidates
    proposer = MagicMock(); proposer.propose = _propose

    orch = Orchestrator(
        db=db_mock, bus=bus,
        ingestor=ingestor, sampler=sampler,
        frame_analyzer=frame_analyzer,
        ref_proposer=proposer, verifier=verifier,
        enricher=enricher,
    )

    async def collect():
        async for ev in bus.subscribe("abc"):
            if ev.step == "done":
                return
    consumer = asyncio.create_task(collect())
    await orch.run("https://www.youtube.com/watch?v=abc")
    await asyncio.wait_for(consumer, timeout=2.0)

    saved_report = db_mock.save_report.call_args.args[0]
    # graceful degrade: references saved with unrelated fields intact
    assert saved_report.references[0].medium is None
```

- [ ] **Step 2: Run; tests should fail (Orchestrator doesn't yet accept `enricher`)**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_orchestrator.py::test_orchestrator_emits_enrich_step_and_uses_enriched_refs backend/tests/unit/test_orchestrator.py::test_orchestrator_continues_when_enricher_raises -q`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'enricher'`.

- [ ] **Step 3: Update `Orchestrator.__init__`**

In `backend/app/pipeline/orchestrator.py`, modify the constructor signature to accept `enricher`:

```python
    def __init__(
        self,
        *,
        db: Database,
        bus: EventBus,
        ingestor: Ingestor,
        sampler: ShotSampler,
        frame_analyzer: FrameAnalyzer,
        ref_proposer: RefProposer,
        verifier: Verifier,
        enricher: "WikidataEnricher | None" = None,
    ):
        self._db = db
        self._bus = bus
        self._ingestor = ingestor
        self._sampler = sampler
        self._frame_analyzer = frame_analyzer
        self._ref_proposer = ref_proposer
        self._verifier = verifier
        self._enricher = enricher
```

And add the import at the top of the file:

```python
from app.pipeline.wikidata_enricher import WikidataEnricher
```

(The string annotation becomes a real `WikidataEnricher | None` once `WikidataEnricher` is imported. Adjust accordingly.)

- [ ] **Step 4: Insert the enrich call after `verify_all`**

In `backend/app/pipeline/orchestrator.py`, find the block (after `verify_all` returns and before the `Report` is built). The current code is:

```python
            verified = await self._verifier.verify_all(
                candidates, frame_index, on_progress=_on_verify_progress,
            )
            kept = [v for v in verified if v.final_confidence.value != "hidden"]

            report = Report(
                youtube_id=yid,
                title=ingest.title,
                ...
```

Replace it with:

```python
            verified = await self._verifier.verify_all(
                candidates, frame_index, on_progress=_on_verify_progress,
            )

            if self._enricher is not None:
                await self._emit(
                    yid, "verify",
                    f"Enriching {len(verified)} with Wikidata",
                    0.95,
                )
                try:
                    enriched = await self._enricher.enrich(
                        verified, on_progress=_on_verify_progress,
                    )
                except Exception:
                    logger.exception("wikidata enrichment failed")
                    enriched = verified
            else:
                enriched = verified

            # Stable visual order: report.references[n] must match the n-th
            # card on the report grid (which sorts by timestamp_s at render).
            enriched.sort(key=lambda r: r.timestamp_s)

            kept = [v for v in enriched if v.final_confidence.value != "hidden"]

            report = Report(
                youtube_id=yid,
                title=ingest.title,
                ...
```

- [ ] **Step 5: Run the new tests + existing orchestrator tests**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_orchestrator.py -q`
Expected: PASS (all tests, including the new two and the existing fixtures — the existing tests don't pass `enricher=`, which is fine because it defaults to None).

- [ ] **Step 6: Commit**

```bash
git add backend/app/pipeline/orchestrator.py backend/tests/unit/test_orchestrator.py
git commit -m "feat(backend): orchestrator runs WikidataEnricher after verify and sorts references"
```

---

### Task 11: Wire WikidataEnricher in `main.py` and run full backend suite

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add the import and the wiring**

In `backend/app/main.py`, add to the imports:

```python
from app.pipeline.wikidata_enricher import WikidataEnricher
```

Then in `_build_default_app`, modify the `Orchestrator` construction:

```python
def _build_default_app() -> FastAPI:
    db = Database(db_path=settings.db_path)
    bus = EventBus()
    nim = NimClient(api_key=settings.nvapi_key, base_url=settings.nim_base_url)
    work_dir = settings.data_dir / "downloads"
    frames_dir = settings.data_dir / "frames"
    enricher = (
        WikidataEnricher(
            concurrency=settings.wikidata_concurrency,
            timeout_s=settings.wikidata_timeout_s,
        )
        if settings.wikidata_enrichment
        else None
    )
    orch = Orchestrator(
        db=db, bus=bus,
        ingestor=Ingestor(work_dir=work_dir),
        sampler=ShotSampler(
            out_dir=frames_dir,
            max_shots=settings.max_shots_per_video,
            frames_per_shot=settings.frames_per_shot,
        ),
        frame_analyzer=FrameAnalyzer(
            nim_client=nim,
            model=settings.cosmos_reason_model,
            concurrency=settings.nim_concurrency,
        ),
        ref_proposer=RefProposer(nim_client=nim, model=settings.llm_model),
        verifier=Verifier(
            nim_client=nim,
            model=settings.llm_model,
            wikipedia=settings.wikipedia_verification,
            concurrency=settings.nim_concurrency,
        ),
        enricher=enricher,
    )
    return build_app(db=db, bus=bus, run_pipeline=orch.run)
```

- [ ] **Step 2: Run the full backend suite**

Run: `docker exec clip-decoder-backend-1 python -m pytest -q --ignore=tests/integration/test_e2e.py`
Expected: PASS — count should be the prior 64 + the new tests from this phase (~12 new) = ~76 tests. All green.

- [ ] **Step 3: Smoke-import to confirm the app boots**

Run: `docker exec clip-decoder-backend-1 python -c "from app.main import app; print(app.title)"`
Expected: prints `ClipDecoder API`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py
git commit -m "feat(backend): wire WikidataEnricher in default app builder"
```

---

## Phase E — Frontend foundation

### Task 12: Update `lib/types.ts`

**Files:**
- Modify: `frontend/lib/types.ts`

- [ ] **Step 1: Update `VerifiedReference` and remove `reasoning`**

In `frontend/lib/types.ts`, find the `VerifiedReference` interface and replace it with:

```ts
export interface VerifiedReference {
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

  cross_ref_reasoning: string;
  adversarial_reasoning: string;
  wikipedia_reasoning: string;
  medium: string | null;
  institution: string | null;
  inception_year: number | null;
}
```

- [ ] **Step 2: Run tsc — expect failures**

Run: `cd frontend && npx tsc --noEmit`
Expected: FAIL — uses of `reference.reasoning` in `ReferenceCard.tsx` and the fixture in `reportStats.test.ts` will now error. Note the exact files for the next tasks.

- [ ] **Step 3: Commit (typings only)**

```bash
git add frontend/lib/types.ts
git commit -m "feat(frontend): VerifiedReference adds 3 reasoning fields + 3 Wikidata fields"
```

---

### Task 13: Adapt `reportStats.test.ts` fixture

**Files:**
- Modify: `frontend/lib/reportStats.test.ts`

- [ ] **Step 1: Update the fixture**

In `frontend/lib/reportStats.test.ts`, replace the `makeRef` function:

```ts
function makeRef(overrides: Partial<VerifiedReference>): VerifiedReference {
  return {
    timestamp_s: 0,
    source_frame_id: "shot_00",
    work_title: "Untitled",
    work_creator: "Anon",
    work_year: 2000,
    work_type: "Painting",
    raw_confidence: 0.5,
    verdict: "keep",
    final_confidence: "confirmed",
    supporting_elements: [],
    wikipedia_url: null,
    cross_ref_reasoning: "",
    adversarial_reasoning: "",
    wikipedia_reasoning: "",
    medium: null,
    institution: null,
    inception_year: null,
    ...overrides,
  };
}
```

- [ ] **Step 2: Run the tests**

Run: `cd frontend && npx vitest run lib/reportStats.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/reportStats.test.ts
git commit -m "test(frontend): adapt reportStats fixture for new VerifiedReference shape"
```

---

### Task 14: Create `lib/api-server.ts` for server-side fetch

**Files:**
- Create: `frontend/lib/api-server.ts`

- [ ] **Step 1: Create the file**

Create `frontend/lib/api-server.ts`:

```ts
import "server-only";
import type { Report } from "./types";

/**
 * Server-side fetch for the report. Distinct from `fetchReport` in
 * `lib/api.ts`, which uses a relative URL (browser-only). Server
 * components run in Node and need an absolute URL.
 *
 * Uses BACKEND_URL — the same env var that `next.config.ts` rewrites
 * /api/* to — so the rewrite target and the server-side fetch target
 * stay aligned. Defaults to the docker-compose service name.
 */
export async function fetchReportServer(youtubeId: string): Promise<Report | null> {
  const base = process.env.BACKEND_URL ?? "http://backend:8000";
  const r = await fetch(`${base}/api/report/${encodeURIComponent(youtubeId)}`, {
    cache: "no-store",
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`report failed: ${r.status}`);
  return (await r.json()) as Report;
}
```

- [ ] **Step 2: Verify tsc**

Run: `cd frontend && npx tsc --noEmit`
Expected: still failing on `ReferenceCard.tsx` (next task) but no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api-server.ts
git commit -m "feat(frontend): add fetchReportServer for SSR with absolute URL"
```

---

### Task 15: Hash-based seek useEffect in `ReportContent.tsx`

**Files:**
- Modify: `frontend/components/report/ReportContent.tsx`
- Create: `frontend/components/report/ReportContent.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/components/report/ReportContent.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Mock VideoPlayer so the test does not load a YouTube iframe.
vi.mock("@/components/VideoPlayer", () => {
  const React = require("react");
  return {
    VideoPlayer: React.forwardRef((_props: { youtubeId: string }, ref: any) => {
      const handle = { seekTo: vi.fn() };
      React.useImperativeHandle(ref, () => handle);
      // Expose the spy globally so the test can inspect it
      (globalThis as any).__lastSeekTo = handle.seekTo;
      return null;
    }),
  };
});
vi.mock("@/lib/api", () => ({
  flagReference: vi.fn(),
}));

import { ReportContent } from "./ReportContent";
import type { Report } from "@/lib/types";

const fakeReport: Report = {
  youtube_id: "abc",
  title: "T",
  channel: "C",
  duration_s: 100,
  references: [],
  frame_analyses: [],
};

beforeEach(() => {
  window.location.hash = "";
  (globalThis as any).__lastSeekTo = vi.fn();
});
afterEach(() => {
  window.location.hash = "";
});

describe("ReportContent hash-seek", () => {
  it("calls seekTo when hash is #t=NN and clears the hash", async () => {
    window.location.hash = "#t=42.5";
    render(<ReportContent report={fakeReport} youtubeId="abc" />);
    await new Promise((r) => setTimeout(r, 10));
    expect((globalThis as any).__lastSeekTo).toHaveBeenCalledWith(42.5);
    expect(window.location.hash).toBe("");
  });

  it("does not call seekTo when hash is absent", async () => {
    render(<ReportContent report={fakeReport} youtubeId="abc" />);
    await new Promise((r) => setTimeout(r, 10));
    expect((globalThis as any).__lastSeekTo).not.toHaveBeenCalled();
  });

  it("does not call seekTo when hash is malformed", async () => {
    window.location.hash = "#t=abc";
    render(<ReportContent report={fakeReport} youtubeId="abc" />);
    await new Promise((r) => setTimeout(r, 10));
    expect((globalThis as any).__lastSeekTo).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect failure (no useEffect yet)**

Run: `cd frontend && npx vitest run components/report/ReportContent.test.tsx`
Expected: FAIL — first test fails because `seekTo` is never called.

- [ ] **Step 3: Add the useEffect to `ReportContent.tsx`**

In `frontend/components/report/ReportContent.tsx`, immediately after the other top-level `useEffect`s (after the `selectedTypes` one), insert:

```ts
  // SP4 — hash-based seek. When the user lands on /report/{id}#t=42.5
  // (typically returning from a reference detail page's JUMP action),
  // seek the embedded player to that timestamp once it has mounted,
  // then clear the hash so a future share/copy of the URL does not
  // re-seek silently.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = window.location.hash.match(/^#t=(\d+(?:\.\d+)?)$/);
    if (!m) return;
    const t = Number.parseFloat(m[1]);
    if (Number.isNaN(t)) return;
    const timer = setTimeout(() => {
      playerRef.current?.seekTo(t);
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [report]);
```

- [ ] **Step 4: Re-run the tests — should now pass**

Run: `cd frontend && npx vitest run components/report/ReportContent.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/report/ReportContent.tsx frontend/components/report/ReportContent.test.tsx
git commit -m "feat(frontend): ReportContent seeks player on #t=NN hash + clears it"
```

---

## Phase F — Frontend report grid update

### Task 16: Refactor `ReferenceCard.tsx` — Link wrap + button anchors

**Files:**
- Modify: `frontend/components/ReferenceCard.tsx`

- [ ] **Step 1: Replace the file**

Overwrite `frontend/components/ReferenceCard.tsx` with:

```tsx
"use client";
import Link from "next/link";
import type { VerifiedReference } from "@/lib/types";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

const VERDICT_META: Record<
  string,
  { label: string; icon: string; chipExtra: string; confExtra: string }
> = {
  confirmed: { label: "CONFIRMED", icon: "●", chipExtra: "", confExtra: "" },
  speculative: { label: "SPECULATIVE", icon: "◌", chipExtra: "chip-cyan", confExtra: "conf-cyan" },
  hidden: { label: "HIDDEN", icon: "✕", chipExtra: "chip-dim", confExtra: "conf-rose" },
};

export function ReferenceCard({
  reference,
  index,
  paletteHex,
  paletteDescriptors,
  youtubeId,
  onJump,
  onFlag,
}: {
  reference: VerifiedReference;
  index: number;
  paletteHex: string[];
  paletteDescriptors: string[];
  youtubeId: string;
  onJump: () => void;
  onFlag: () => void;
}) {
  const verdict = reference.final_confidence;
  const meta = VERDICT_META[verdict];
  const tc = formatTimecode(reference.timestamp_s);
  const isHidden = verdict === "hidden";
  const confPercent = Math.round(reference.raw_confidence * 100);
  const detailHref = `/report/${youtubeId}/ref/${index}`;

  return (
    <article className={`ref ref-${verdict}`}>
      {/* Visual region — clickable Link to the detail page. */}
      <Link
        href={detailHref}
        className="ref-link"
        aria-label={`Open detail for ${reference.work_title} at ${tc}`}
      >
        <div className="ref-left">
          <div
            className="thumb"
            style={{
              backgroundImage: `url(/api/frames/${youtubeId}/${reference.source_frame_id})`,
              filter: isHidden ? "grayscale(0.7) brightness(0.6)" : undefined,
            }}
          >
            <span className="tc-overlay">
              {tc} · {reference.source_frame_id.toUpperCase()}
            </span>
          </div>
          {paletteHex.length > 0 && (
            <>
              <div
                className="palette"
                style={{ marginTop: 8, opacity: isHidden ? 0.4 : 1 }}
              >
                {paletteHex.map((hex, i) => (
                  <span key={i} style={{ background: hex }} />
                ))}
              </div>
              {paletteDescriptors.length > 0 && (
                <div className="hairline palette-label">
                  PALETTE · {paletteDescriptors.join(" → ").toUpperCase()}
                </div>
              )}
            </>
          )}
        </div>

        <div className="ref-right">
          <div className="ref-verdict-line">
            <span className={`verdict-marker verdict-${verdict}`}>
              {meta.icon} {meta.label}
            </span>
            <span>·</span>
            <span>{reference.work_type}</span>
            {reference.wikipedia_url && (
              <>
                <span>·</span>
                <span>Wikipedia verified</span>
              </>
            )}
          </div>

          <div className="ref-title-row">
            <h3
              className={`serif-it ref-title ${isHidden ? "ref-title-rejected" : ""}`}
            >
              <em>{reference.work_title}</em>
            </h3>
            {reference.wikipedia_thumbnail_url && (
              <img
                src={reference.wikipedia_thumbnail_url}
                alt=""
                className="wiki-thumb"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
          </div>

          <div className="ref-meta">
            {reference.work_creator} · {reference.work_year ?? "—"} ·{" "}
            {reference.work_type}
          </div>

          <p className="ref-reasoning">{reference.cross_ref_reasoning}</p>

          {reference.supporting_elements.length > 0 && (
            <div className="ev">
              {reference.supporting_elements.map((el, i) => (
                <span key={i} className={`chip ${meta.chipExtra}`}>
                  {el}
                </span>
              ))}
            </div>
          )}

          <div className={`conf ${meta.confExtra}`}>
            <span>CONFIDENCE</span>
            <span className="bar">
              <i style={{ width: `${confPercent}%` }} />
            </span>
            <span>{reference.raw_confidence.toFixed(2)}</span>
          </div>
        </div>
      </Link>

      {/* Action row — sits outside the Link so anchors/buttons here do not
          nest inside another <a>. */}
      <div className="ref-actions">
        <button
          type="button"
          className="ulink"
          onClick={onJump}
        >
          ▸ JUMP TO {tc}
        </button>
        {reference.wikipedia_url && (
          <a
            className="ulink"
            href={reference.wikipedia_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            WIKIPEDIA ↗
          </a>
        )}
        {!isHidden && (
          <button
            type="button"
            className="ulink ulink-muted"
            onClick={onFlag}
          >
            NOT CONVINCED ✕
          </button>
        )}
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Update the consumer in `ReportContent.tsx` to pass `index`**

In `frontend/components/report/ReportContent.tsx`, find the `filteredRefs.map((ref) => { ... })` block and update the `<ReferenceCard>` call so `index` is the position in the **unfiltered** `report.references` (already computed as `idx`):

```tsx
return (
  <ReferenceCard
    key={`${ref.source_frame_id}-${idx}`}
    reference={ref}
    index={idx}
    paletteHex={paletteHex}
    paletteDescriptors={paletteDescriptors}
    youtubeId={report.youtube_id}
    onJump={() => jumpTo(ref)}
    onFlag={() => handleFlag(idx)}
  />
);
```

- [ ] **Step 3: Run tsc + vitest**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: PASS — tsc clean, all existing tests still green.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/ReferenceCard.tsx frontend/components/report/ReportContent.tsx
git commit -m "refactor(frontend): ReferenceCard wraps visual region in <Link>, actions become <button>s"
```

---

### Task 17: SP4 CSS block in `globals.css`

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Append the SP4 section**

Append at the end of `frontend/app/globals.css`:

```css
/* ─────────────────────────────────────────────────────────────────
   SP4 — Reference detail page (frame 04 of the mockup).
   ───────────────────────────────────────────────────────────────── */

.detail {
  display: grid;
  grid-template-rows: auto auto auto;
  gap: 24px;
  padding: clamp(32px, 4vw, 56px) clamp(32px, 5vw, 64px);
}

.detail-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 24px;
}
.detail-top h1 {
  font-family: var(--serif);
  font-weight: 400;
  font-style: italic;
  font-size: clamp(36px, 4vw, 48px);
  letter-spacing: -0.025em;
  margin: 0;
  color: var(--ink);
}
.detail-top h1 .by {
  font-style: normal;
  color: var(--body);
}
.detail-top-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.detail-compare {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}
@media (max-width: 900px) {
  .detail-compare { grid-template-columns: 1fr; }
}
.detail-pane {
  background: var(--surface-card);
  border: 1px solid var(--hairline);
  border-radius: var(--r-2);
  overflow: hidden;
}
.detail-pane .img {
  aspect-ratio: 16/9;
  background: #000;
  position: relative;
  overflow: hidden;
}
.detail-pane .img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.detail-pane.placeholder .img {
  background:
    repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 12px),
    linear-gradient(135deg, #1a1612 0%, #25201b 100%);
  display: grid;
  place-items: center;
  font-family: var(--sans);
  font-size: 12px;
  letter-spacing: 0.96px;
  text-transform: uppercase;
  color: var(--muted);
}
.detail-pane .body { padding: 14px 18px; }
.detail-pane .body .lbl {
  font-family: var(--sans);
  font-size: 11px;
  letter-spacing: 0.96px;
  text-transform: uppercase;
  color: var(--grad-peach);
  margin-bottom: 6px;
}
.detail-pane .body .ttl {
  font-family: var(--serif);
  font-size: 18px;
  line-height: 1.2;
  letter-spacing: -0.015em;
  color: var(--ink);
}
.detail-pane .body .ttl.serif-it {
  font-style: italic;
}
.detail-pane .body .sub {
  font-family: var(--serif);
  font-style: italic;
  font-size: 13px;
  color: var(--body);
  margin-top: 4px;
}

.detail-evidence {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 24px;
}
@media (max-width: 900px) {
  .detail-evidence { grid-template-columns: 1fr; }
}
.detail-reasoning,
.detail-frame-analysis {
  background: var(--surface-card);
  border: 1px solid var(--hairline);
  border-radius: var(--r-2);
  padding: 22px 24px;
}
.detail-reasoning .h,
.detail-frame-analysis .h {
  font-family: var(--serif);
  font-style: italic;
  font-size: 14px;
  color: var(--muted);
  margin-bottom: 14px;
}
.detail-reasoning .pull-quote {
  font-family: var(--serif);
  font-style: italic;
  font-size: 19px;
  line-height: 1.45;
  color: var(--ink);
  border-left: 2px solid var(--grad-peach);
  padding-left: 16px;
  margin: 0 0 18px;
}
.detail-reasoning p {
  font-family: var(--sans);
  font-size: 14.5px;
  line-height: 1.65;
  color: var(--body-strong);
  margin: 0 0 14px;
}
.detail-reasoning p .label {
  font-family: var(--serif);
  font-style: italic;
  color: var(--ink);
  margin-right: 4px;
}

.detail-frame-analysis dl {
  display: grid;
  gap: 14px;
  margin: 0;
}
.detail-frame-analysis dt {
  font-family: var(--sans);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.96px;
  text-transform: uppercase;
  color: var(--muted);
}
.detail-frame-analysis dd {
  margin: 2px 0 0;
  font-family: var(--sans);
  font-size: 13px;
  color: var(--ink);
  line-height: 1.5;
}
.detail-frame-analysis .palette-row {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.detail-frame-analysis .palette-row .swatch {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  border: 1px solid rgba(255,255,255,0.06);
}
.detail-frame-analysis .palette-row .label {
  font-family: var(--sans);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--muted);
}

/* DetailSlate — extends .slate with a focus position chip and PREV/NEXT/ESC links. */
.detail-slate .nav-link {
  font-family: var(--sans);
  font-size: 12px;
  letter-spacing: 0.96px;
  text-transform: uppercase;
  color: var(--body);
  text-decoration: none;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--hairline);
}
.detail-slate .nav-link:hover {
  color: var(--ink);
  border-color: var(--muted);
}
.detail-slate .nav-link.disabled {
  color: var(--muted-soft);
  border-color: var(--hairline);
  cursor: not-allowed;
  pointer-events: none;
}

/* ReferenceCard — the Link wrap needs to be display:contents so the
   existing flex layout of .ref keeps working. */
.ref .ref-link {
  display: flex;
  gap: 20px;
  flex: 1;
  text-decoration: none;
  color: inherit;
}
.ref .ref-link:focus-visible {
  outline: 2px solid var(--grad-peach);
  outline-offset: 4px;
  border-radius: var(--r-2);
}
```

- [ ] **Step 2: Visual smoke (no automated test for raw CSS)**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: PASS (no regressions; CSS is layout-only).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(frontend): SP4 CSS block — detail page grid, compare panes, evidence chain, frame analysis dl"
```

---

## Phase G — Detail sub-components

### Task 18: `DetailSlate` component

**Files:**
- Create: `frontend/components/report/detail/DetailSlate.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/report/detail/DetailSlate.tsx`:

```tsx
"use client";
import Link from "next/link";
import type { VerifiedReference } from "@/lib/types";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

export function DetailSlate({
  youtubeId,
  reference,
  index,
  total,
}: {
  youtubeId: string;
  reference: VerifiedReference;
  index: number;
  total: number;
}) {
  const prevDisabled = index <= 0;
  const nextDisabled = index >= total - 1;
  const tc = formatTimecode(reference.timestamp_s);
  const shotId = reference.source_frame_id.toUpperCase();
  const reportHref = `/report/${youtubeId}`;
  return (
    <div className="slate detail-slate">
      <span className="dot" />
      <b>FOCUS · REFERENCE {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</b>
      <span className="sep" />
      <span className="tc">{tc} · {shotId}</span>
      <span className="sep" />
      {prevDisabled ? (
        <span className="nav-link disabled" aria-disabled="true">← PREV</span>
      ) : (
        <Link className="nav-link" href={`/report/${youtubeId}/ref/${index - 1}`}>← PREV</Link>
      )}
      {nextDisabled ? (
        <span className="nav-link disabled" aria-disabled="true">NEXT →</span>
      ) : (
        <Link className="nav-link" href={`/report/${youtubeId}/ref/${index + 1}`}>NEXT →</Link>
      )}
      <Link className="nav-link" href={reportHref}>ESC</Link>
    </div>
  );
}
```

- [ ] **Step 2: tsc smoke**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/report/detail/DetailSlate.tsx
git commit -m "feat(frontend): add DetailSlate (FOCUS slate + PREV/NEXT/ESC nav links)"
```

---

### Task 19: `DetailTopRow` component

**Files:**
- Create: `frontend/components/report/detail/DetailTopRow.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/report/detail/DetailTopRow.tsx`:

```tsx
"use client";
import type { VerifiedReference } from "@/lib/types";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

const VERDICT_DOT: Record<string, string> = {
  confirmed: "var(--grad-peach)",
  speculative: "var(--grad-sky)",
  hidden: "var(--muted)",
};

export function DetailTopRow({
  reference,
  onJump,
  onFlag,
}: {
  reference: VerifiedReference;
  onJump: () => void;
  onFlag: () => void;
}) {
  const verdictLabel = reference.final_confidence.toUpperCase();
  const tc = formatTimecode(reference.timestamp_s);
  return (
    <div className="detail-top">
      <div>
        <div className="hairline" style={{ marginBottom: 8 }}>
          <span style={{ color: VERDICT_DOT[reference.final_confidence] }}>● {verdictLabel}</span>
          &nbsp; · &nbsp; {reference.work_type.toUpperCase()}
          {reference.wikipedia_url && (
            <>&nbsp; · &nbsp; WIKIPEDIA VERIFIED</>
          )}
          &nbsp; · &nbsp; CONFIDENCE {reference.raw_confidence.toFixed(2)}
        </div>
        <h1>
          {reference.work_title}
          <span className="by">
            {" "}— {reference.work_creator}
            {reference.work_year !== null ? `, ${reference.work_year}` : ""}
          </span>
        </h1>
      </div>
      <div className="detail-top-actions">
        {reference.final_confidence !== "hidden" && (
          <button type="button" className="btn btn-ghost" onClick={onFlag}>
            NOT CONVINCED ✕
          </button>
        )}
        <button type="button" className="btn" onClick={onJump}>
          JUMP ▸ {tc}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc smoke**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/report/detail/DetailTopRow.tsx
git commit -m "feat(frontend): add DetailTopRow (verdict line, serif title, JUMP/NOT-CONVINCED actions)"
```

---

### Task 20: `DetailCompare` component + tests

**Files:**
- Create: `frontend/components/report/detail/DetailCompare.tsx`
- Create: `frontend/components/report/detail/DetailCompare.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/components/report/detail/DetailCompare.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DetailCompare } from "./DetailCompare";
import type { VerifiedReference, FrameAnalysis } from "@/lib/types";

const fa: FrameAnalysis = {
  timestamp_s: 12,
  frame_id: "shot_03",
  composition: "centered subject filling 90% of frame",
  palette: ["midnight", "sodium"],
  palette_hex: ["#111", "#fa3"],
  camera_move: "static",
  costume_setting: "indoor",
  distinctive_features: ["symmetry"],
  raw_description: "x",
  confidence_in_observation: 0.94,
};
const baseRef: VerifiedReference = {
  timestamp_s: 12,
  source_frame_id: "shot_03",
  work_title: "Le faux miroir",
  work_creator: "René Magritte",
  work_year: 1929,
  work_type: "painting",
  raw_confidence: 0.91,
  verdict: "keep",
  final_confidence: "confirmed",
  supporting_elements: [],
  wikipedia_url: "https://en.wikipedia.org/wiki/Le_faux_miroir",
  wikipedia_thumbnail_url: "https://upload.wikimedia.org/foo.jpg",
  cross_ref_reasoning: "x",
  adversarial_reasoning: "x",
  wikipedia_reasoning: "x",
  medium: "oil on canvas",
  institution: "Museum of Modern Art",
  inception_year: 1929,
};

describe("DetailCompare", () => {
  it("renders the wikipedia thumbnail when present", () => {
    render(<DetailCompare reference={baseRef} frame={fa} youtubeId="abc" frameIndex={0} />);
    const img = screen.getByAltText("");
    expect(img).toHaveAttribute("src", "https://upload.wikimedia.org/foo.jpg");
  });

  it("renders the placeholder when thumbnail is null", () => {
    render(
      <DetailCompare
        reference={{ ...baseRef, wikipedia_thumbnail_url: null }}
        frame={fa}
        youtubeId="abc"
        frameIndex={0}
      />,
    );
    expect(screen.getByText(/reference image/i)).toBeInTheDocument();
  });

  it("joins only non-null metadata in the right-pane sub line", () => {
    render(
      <DetailCompare
        reference={{ ...baseRef, medium: null }}
        frame={fa}
        youtubeId="abc"
        frameIndex={0}
      />,
    );
    const sub = screen.getByTestId("detail-compare-sub");
    // medium is null → should NOT be in the joined string
    expect(sub.textContent).toContain("René Magritte");
    expect(sub.textContent).toContain("1929");
    expect(sub.textContent).toContain("Museum of Modern Art");
    expect(sub.textContent).not.toContain("oil on canvas");
  });
});
```

- [ ] **Step 2: Run the tests — expect import failure**

Run: `cd frontend && npx vitest run components/report/detail/DetailCompare.test.tsx`
Expected: FAIL — `Failed to load module ./DetailCompare`.

- [ ] **Step 3: Create the component**

Create `frontend/components/report/detail/DetailCompare.tsx`:

```tsx
"use client";
import type { FrameAnalysis, VerifiedReference } from "@/lib/types";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function truncate(s: string | undefined, max: number): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function DetailCompare({
  reference,
  frame,
  youtubeId,
  frameIndex,
}: {
  reference: VerifiedReference;
  frame: FrameAnalysis | undefined;
  youtubeId: string;
  frameIndex: number; // for the left-pane title "Frame N"
}) {
  const tc = formatTimecode(reference.timestamp_s);
  const shotId = reference.source_frame_id.toUpperCase();
  const compositionShort = truncate(frame?.composition, 60);

  // Right-pane sub line: join only the non-null metadata fields with " · ".
  const rightSubParts = [
    reference.work_creator,
    reference.work_year !== null ? String(reference.work_year) : null,
    reference.medium,
    reference.institution,
  ].filter((x): x is string => Boolean(x));

  return (
    <div className="detail-compare">
      <div className="detail-pane">
        <div className="img">
          <img
            src={`/api/frames/${youtubeId}/${reference.source_frame_id}`}
            alt=""
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
        <div className="body">
          <div className="lbl">From the clip · {tc} · {shotId}</div>
          <div className="ttl">
            Frame {String(frameIndex).padStart(3, "0")}
            {compositionShort ? ` — ${compositionShort}` : ""}
          </div>
          {frame && (
            <div className="sub">
              Camera {frame.camera_move} ·{" "}
              {truncate(frame.costume_setting, 60) || "indeterminate setting"}
            </div>
          )}
        </div>
      </div>

      <div className={`detail-pane ${reference.wikipedia_thumbnail_url ? "" : "placeholder"}`}>
        <div className="img">
          {reference.wikipedia_thumbnail_url ? (
            <img
              src={reference.wikipedia_thumbnail_url}
              alt=""
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <>Reference image · drop here</>
          )}
        </div>
        <div className="body">
          <div className="lbl">Reference work</div>
          <div className="ttl serif-it">{reference.work_title}</div>
          <div className="sub" data-testid="detail-compare-sub">
            {rightSubParts.join(" · ")}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Re-run tests — should pass**

Run: `cd frontend && npx vitest run components/report/detail/DetailCompare.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/report/detail/DetailCompare.tsx frontend/components/report/detail/DetailCompare.test.tsx
git commit -m "feat(frontend): add DetailCompare (frame ↔ work side-by-side panes) + tests"
```

---

### Task 21: `DetailReasoning` component + tests

**Files:**
- Create: `frontend/components/report/detail/DetailReasoning.tsx`
- Create: `frontend/components/report/detail/DetailReasoning.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/components/report/detail/DetailReasoning.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DetailReasoning, extractPullQuote } from "./DetailReasoning";

describe("extractPullQuote", () => {
  it("returns the first sentence ending in a period", () => {
    expect(extractPullQuote("The frame is the painting. A single eye fills the canvas."))
      .toBe("The frame is the painting.");
  });
  it("handles ! and ?", () => {
    expect(extractPullQuote("Wow! It is.")).toBe("Wow!");
    expect(extractPullQuote("Is it Magritte? Yes."))
      .toBe("Is it Magritte?");
  });
  it("falls back to a 240-char cap with ellipsis when no terminator", () => {
    const long = "a".repeat(300);
    const q = extractPullQuote(long);
    expect(q.length).toBeLessThanOrEqual(240);
    expect(q.endsWith("…")).toBe(true);
  });
  it("returns the whole string when shorter than 240 chars and no terminator", () => {
    expect(extractPullQuote("short text no terminator"))
      .toBe("short text no terminator");
  });
});

describe("DetailReasoning", () => {
  it("renders the three labeled sections", () => {
    render(
      <DetailReasoning
        crossRef="The frame is the painting."
        adversarial="But the eye is bare in Bergman."
        wikipedia="MoMA accession is correct."
      />,
    );
    expect(screen.getByText(/Cross-reference pass/i)).toBeInTheDocument();
    expect(screen.getByText(/Adversarial pass/i)).toBeInTheDocument();
    expect(screen.getByText(/Wikipedia/i)).toBeInTheDocument();
  });
  it("renders the pull-quote from the first sentence of crossRef", () => {
    render(
      <DetailReasoning
        crossRef="The frame is the painting. A single eye."
        adversarial="x"
        wikipedia="y"
      />,
    );
    expect(screen.getByText("The frame is the painting.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `cd frontend && npx vitest run components/report/detail/DetailReasoning.test.tsx`
Expected: FAIL — `Failed to load module ./DetailReasoning`.

- [ ] **Step 3: Create the component**

Create `frontend/components/report/detail/DetailReasoning.tsx`:

```tsx
"use client";

/**
 * Extract the first sentence from a string, used for the pull-quote.
 * Greedy-stops at the first `.`, `!`, or `?` followed by whitespace or
 * end of string. If no terminator is found within 240 chars, slice to
 * 240 with an ellipsis fallback.
 */
export function extractPullQuote(text: string): string {
  const m = text.match(/^.*?[.!?](?:\s|$)/);
  if (m) return m[0].trim();
  if (text.length <= 240) return text;
  return text.slice(0, 239) + "…";
}

export function DetailReasoning({
  crossRef,
  adversarial,
  wikipedia,
}: {
  crossRef: string;
  adversarial: string;
  wikipedia: string;
}) {
  const pull = extractPullQuote(crossRef);
  return (
    <div className="detail-reasoning">
      <div className="h">EVIDENCE CHAIN · CROSS-REFERENCE → VERIFY</div>
      <p className="pull-quote">{pull}</p>
      <p>
        <span className="label">Cross-reference pass.</span>
        {crossRef}
      </p>
      <p>
        <span className="label">Adversarial pass.</span>
        {adversarial}
      </p>
      <p>
        <span className="label">Wikipedia.</span>
        {wikipedia}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Re-run tests — should pass**

Run: `cd frontend && npx vitest run components/report/detail/DetailReasoning.test.tsx`
Expected: PASS (6 tests — 4 helper + 2 component).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/report/detail/DetailReasoning.tsx frontend/components/report/detail/DetailReasoning.test.tsx
git commit -m "feat(frontend): add DetailReasoning (EVIDENCE CHAIN header, pull-quote, 3 labeled passes) + tests"
```

---

### Task 22: `DetailFrameAnalysis` component

**Files:**
- Create: `frontend/components/report/detail/DetailFrameAnalysis.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/report/detail/DetailFrameAnalysis.tsx`:

```tsx
"use client";
import type { FrameAnalysis } from "@/lib/types";

export function DetailFrameAnalysis({
  frame,
  rawConfidence,
}: {
  frame: FrameAnalysis | undefined;
  rawConfidence: number;
}) {
  if (!frame) {
    return (
      <div className="detail-frame-analysis">
        <div className="h">Frame analysis</div>
        <p className="hairline">Frame analysis unavailable.</p>
      </div>
    );
  }
  const paletteLabel = frame.palette.join(" → ").toUpperCase();
  const paletteHex = frame.palette_hex ?? [];
  return (
    <div className="detail-frame-analysis">
      <div className="h">Frame analysis</div>
      <dl>
        <div>
          <dt>Composition</dt>
          <dd>{frame.composition}</dd>
        </div>
        <div>
          <dt>Palette</dt>
          <dd>
            <div className="palette-row">
              {paletteHex.map((hex, i) => (
                <span key={i} className="swatch" style={{ background: hex }} />
              ))}
              <span className="label">{paletteLabel}</span>
            </div>
          </dd>
        </div>
        <div>
          <dt>Camera</dt>
          <dd>{frame.camera_move}</dd>
        </div>
        <div>
          <dt>Costume / Setting</dt>
          <dd>{frame.costume_setting}</dd>
        </div>
        <div>
          <dt>Distinctive features</dt>
          <dd>{frame.distinctive_features.join(", ") || "—"}</dd>
        </div>
        <div>
          <dt>Vision confidence</dt>
          <dd>
            {rawConfidence.toFixed(2)}{" "}
            <span className="hairline" style={{ marginLeft: 8 }}>
              (raw observation, pre-verify)
            </span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
```

- [ ] **Step 2: tsc smoke**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/report/detail/DetailFrameAnalysis.tsx
git commit -m "feat(frontend): add DetailFrameAnalysis dl (composition, palette swatches, camera, etc.)"
```

---

### Task 23: `DetailNavigation` keyboard listener — test-first

**Files:**
- Create: `frontend/components/report/detail/DetailNavigation.test.tsx`

This component is just a hook-driven keyboard listener used by `ReferenceDetail`. We TDD the keyboard behavior here, then implement the listener inside `ReferenceDetail` in the next task.

- [ ] **Step 1: Write the test for the hook**

Create `frontend/components/report/detail/DetailNavigation.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useDetailKeyboardNav } from "./useDetailKeyboardNav";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function Probe({ index, total, youtubeId }: { index: number; total: number; youtubeId: string }) {
  useDetailKeyboardNav({ youtubeId, index, total });
  return null;
}

afterEach(() => {
  push.mockClear();
});

describe("useDetailKeyboardNav", () => {
  it("ArrowRight pushes /ref/{n+1} when not at end", () => {
    render(<Probe index={0} total={3} youtubeId="abc" />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(push).toHaveBeenCalledWith("/report/abc/ref/1");
  });

  it("ArrowLeft pushes /ref/{n-1} when not at start", () => {
    render(<Probe index={2} total={3} youtubeId="abc" />);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(push).toHaveBeenCalledWith("/report/abc/ref/1");
  });

  it("ArrowRight at last index does nothing", () => {
    render(<Probe index={2} total={3} youtubeId="abc" />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(push).not.toHaveBeenCalled();
  });

  it("ArrowLeft at first index does nothing", () => {
    render(<Probe index={0} total={3} youtubeId="abc" />);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(push).not.toHaveBeenCalled();
  });

  it("Escape pushes /report/{id}", () => {
    render(<Probe index={1} total={3} youtubeId="abc" />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(push).toHaveBeenCalledWith("/report/abc");
  });
});
```

- [ ] **Step 2: Run — expect import failure (`useDetailKeyboardNav` doesn't exist)**

Run: `cd frontend && npx vitest run components/report/detail/DetailNavigation.test.tsx`
Expected: FAIL — `Failed to load module ./useDetailKeyboardNav`.

- [ ] **Step 3: Create the hook**

Create `frontend/components/report/detail/useDetailKeyboardNav.ts`:

```ts
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function useDetailKeyboardNav({
  youtubeId,
  index,
  total,
}: {
  youtubeId: string;
  index: number;
  total: number;
}) {
  const router = useRouter();
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" && index > 0) {
        router.push(`/report/${youtubeId}/ref/${index - 1}`);
      } else if (e.key === "ArrowRight" && index < total - 1) {
        router.push(`/report/${youtubeId}/ref/${index + 1}`);
      } else if (e.key === "Escape") {
        router.push(`/report/${youtubeId}`);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router, youtubeId, index, total]);
}
```

- [ ] **Step 4: Re-run tests — should pass**

Run: `cd frontend && npx vitest run components/report/detail/DetailNavigation.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/report/detail/useDetailKeyboardNav.ts frontend/components/report/detail/DetailNavigation.test.tsx
git commit -m "feat(frontend): useDetailKeyboardNav hook — ←/→/Esc routing + tests"
```

---

### Task 24: `ReferenceDetail` composer + route page

**Files:**
- Create: `frontend/components/report/detail/ReferenceDetail.tsx`
- Create: `frontend/app/report/[id]/ref/[n]/page.tsx`

- [ ] **Step 1: Create `ReferenceDetail.tsx`**

Create `frontend/components/report/detail/ReferenceDetail.tsx`:

```tsx
"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { FrameAnalysis, Report } from "@/lib/types";
import { flagReference } from "@/lib/api";
import { DetailSlate } from "./DetailSlate";
import { DetailTopRow } from "./DetailTopRow";
import { DetailCompare } from "./DetailCompare";
import { DetailReasoning } from "./DetailReasoning";
import { DetailFrameAnalysis } from "./DetailFrameAnalysis";
import { useDetailKeyboardNav } from "./useDetailKeyboardNav";

export function ReferenceDetail({
  report,
  index,
}: {
  report: Report;
  index: number;
}) {
  const reference = report.references[index];
  const total = report.references.length;
  const youtubeId = report.youtube_id;
  const router = useRouter();

  useDetailKeyboardNav({ youtubeId, index, total });

  const frameById = useMemo(() => {
    const m = new Map<string, FrameAnalysis>();
    for (const f of report.frame_analyses) m.set(f.frame_id, f);
    return m;
  }, [report.frame_analyses]);
  const frame = frameById.get(reference.source_frame_id);

  function handleJump() {
    router.push(`/report/${youtubeId}#t=${reference.timestamp_s}`);
  }
  async function handleFlag() {
    await flagReference(youtubeId, index);
  }

  return (
    <main className="frame surface-dark relative min-h-screen flex flex-col">
      <DetailSlate
        youtubeId={youtubeId}
        reference={reference}
        index={index}
        total={total}
      />
      <div className="detail">
        <DetailTopRow
          reference={reference}
          onJump={handleJump}
          onFlag={handleFlag}
        />
        <DetailCompare
          reference={reference}
          frame={frame}
          youtubeId={youtubeId}
          frameIndex={index}
        />
        <div className="detail-evidence">
          <DetailReasoning
            crossRef={reference.cross_ref_reasoning}
            adversarial={reference.adversarial_reasoning}
            wikipedia={reference.wikipedia_reasoning}
          />
          <DetailFrameAnalysis
            frame={frame}
            rawConfidence={reference.raw_confidence}
          />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Create the route**

Create `frontend/app/report/[id]/ref/[n]/page.tsx`:

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

- [ ] **Step 3: Run tsc + full vitest**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: PASS — tsc clean, all tests pass (the full count now includes the new detail tests: prior 19 + ReportContent (3) + DetailCompare (3) + DetailReasoning (6) + DetailNavigation (5) ≈ 36 tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/components/report/detail/ReferenceDetail.tsx frontend/app/report/[id]/ref/[n]/page.tsx
git commit -m "feat(frontend): add ReferenceDetail composer + /report/[id]/ref/[n] route"
```

---

## Phase H — Final verification

### Task 25: Full-suite green + manual smoke checks

**Files:**
- No code changes expected.

- [ ] **Step 1: Run the full backend suite**

Run: `docker exec clip-decoder-backend-1 python -m pytest -q --ignore=tests/integration/test_e2e.py`
Expected: PASS — ~76 tests (64 prior + the new wikidata_enricher tests + adapted orchestrator tests).

- [ ] **Step 2: Run the full frontend suite + tsc**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: PASS — tsc clean, ~36 tests.

- [ ] **Step 3: Clean the DB so a fresh run produces SP4-shaped reports**

Run: `docker exec clip-decoder-backend-1 python -c "import sqlite3; c=sqlite3.connect('/app/data/clipdecoder.sqlite'); c.execute('DELETE FROM analyses'); c.commit(); print('cleared')"`
Expected: prints `cleared`.

- [ ] **Step 4: Run a fresh analysis end-to-end**

Submit a real YouTube URL through the landing page. Wait for `done`. Inspect the resulting report JSON:

Run: `curl -s http://localhost:3000/api/report/<youtube_id> | python -m json.tool | head -120`
Expected: at least one reference shows `cross_ref_reasoning`, `adversarial_reasoning`, `wikipedia_reasoning` non-empty. For a famous artwork, `medium` / `institution` / `inception_year` should be filled (e.g. for "Le faux miroir" → "oil on canvas" / "Museum of Modern Art" / 1929).

- [ ] **Step 5: Visual checklist on the report page**

Open `http://localhost:3000/report/<youtube_id>` in a browser:

1. Click any reference card → navigates to `/report/<id>/ref/0` (or matching n) → DetailSlate at top, 3-section layout matches the mockup.
2. Press `→` arrow key → URL increments, page rerenders.
3. Press `←` from index 1 → URL `/ref/0`.
4. At `/ref/0` → PREV link visually disabled, no nav on click.
5. At last index → NEXT disabled.
6. Press `Esc` → URL back to `/report/{id}`.
7. Click `JUMP ▸` inside the detail page → returns to report, the embedded player seeks to the timestamp, the hash is cleared.
8. Click `NOT CONVINCED ✕` → row appears in the flagged_references table.
9. Open `/report/<id>/ref/9999` → Next.js 404 page.
10. Open `/report/<id>/ref/-1` → Next.js 404 page.
11. Open `/report/<id>/ref/0` directly in a new tab → page renders SSR (no flash to a loading state).
12. Open the detail page for a hidden-verdict ref directly — page renders normally (filter-neutral).
13. Test reduced-motion: in DevTools force `prefers-reduced-motion: reduce` → no animations on the detail page.

If any step fails, note the failure (file + observed behavior), fix, commit with a `fix(frontend|backend): ...` message, then re-run the checklist from that step.

- [ ] **Step 6: No commit unless cleanup was needed**

If you ran cleanup fixes in step 5, they should have been committed individually. Otherwise nothing to commit here.

---

## Self-review

**Spec coverage check:**

| Spec section | Plan tasks |
| --- | --- |
| `ReferenceCandidate` drop `reasoning` + ref_proposer prompts | Task 1 |
| `VerifiedReference` extension | Task 2 |
| Verifier prompt rewrite | Task 3 |
| `_wiki_lookup` → 3-tuple | Task 4 |
| Verifier flow reorder + new fields | Task 5 |
| Settings | Task 6 |
| WikidataEnricher (helpers + network + concurrency) | Tasks 7, 8, 9 |
| Orchestrator integration + sort | Task 10 |
| `main.py` wiring | Task 11 |
| `lib/types.ts` updates | Task 12 |
| `reportStats.test.ts` fixture | Task 13 |
| `lib/api-server.ts` | Task 14 |
| Hash-seek useEffect + tests | Task 15 |
| `ReferenceCard` refactor | Task 16 |
| CSS additions | Task 17 |
| DetailSlate | Task 18 |
| DetailTopRow | Task 19 |
| DetailCompare + tests | Task 20 |
| DetailReasoning + tests | Task 21 |
| DetailFrameAnalysis | Task 22 |
| DetailNavigation hook + tests | Task 23 |
| ReferenceDetail composer + route | Task 24 |
| Full-suite green + manual checklist | Task 25 |

All spec items have at least one task.

**Type consistency check:**

- `cross_ref_reasoning`, `adversarial_reasoning`, `wikipedia_reasoning` — used identically in `models.py` (Task 2), `verifier.py` (Task 5), `prompts/verifier.md` (Task 3), `lib/types.ts` (Task 12), `DetailReasoning` (Task 21 — passed as separate props `crossRef`/`adversarial`/`wikipedia` for cleanliness), `ReferenceDetail` (Task 24, passes the right field to each prop). Consistent.
- `medium`, `institution`, `inception_year` — Pydantic model (Task 2), Enricher (Task 8), types.ts (Task 12), DetailCompare right-sub line (Task 20). Consistent.
- `WikidataEnricher` constructor: `concurrency=`, `timeout_s=` — set in Task 7/8, called from `main.py` (Task 11) with `wikidata_concurrency` / `wikidata_timeout_s` settings. Consistent.
- `enricher` param on `Orchestrator`: optional, defaults to None (Task 10). main.py passes a real instance or None depending on the `wikidata_enrichment` setting (Task 11). Consistent.

**No placeholders.** All steps have concrete code blocks, exact commands with expected output, and explicit commit messages.
