# Reference Proposer — Multi-Pass Diversity

**Date:** 2026-05-09
**Status:** Design
**Owner:** lmoheyma

## Problem

Across the 5 music videos analyzed so far, the pipeline produces:

| Clip | total refs | breakdown |
|---|---|---|
| PNL — A l'Ammoniaque | 5 | 5 films |
| Coldplay — Viva La Vida | 5 | 5 films |
| Moha MMZ — Pinkman | 0 | nothing |
| S.Pri Noir — Ensemble | 4 | 4 films |
| MMZ — S Line | 3 | 3 films |

**17 references total, 100% films.** Coldplay's "Viva La Vida" famously evokes Eugène Delacroix's painting *Liberty Leading the People* — yet zero paintings surface. The bias is structural in the proposer prompt and the model's anchor on the first item of the type list (`<film | painting | photograph | music_video | other>`).

**Goal:** for a typical 3-4min clip, surface **8-12 references** with **diversity across work_type** (paintings, photographs, music videos, fashion editorials surface alongside films). Some `speculative`-bucket references are acceptable — the user already toggles between confirmed/speculative on the report page.

## Non-goals

- Touching the frame_analyzer prompt or schema. The VLM's `raw_description` already returns free-form text; if a frame looks like a Helmut Newton photograph, that signal is already there for the proposer to read. Enriching the analyzer is a follow-up if the prompt-only fix proves insufficient.
- Touching the verifier prompt or rubric. Its 3+-element criterion applies equally well across types.
- Schema migration. `ReferenceCandidate.work_type` stays `str`; the prompt drives the controlled vocabulary.
- A golden-set evaluation harness (out of scope for this iteration; the manual verification plan checks the 5 known clips).

## Architecture

The orchestrator's contract with `RefProposer.propose(...)` does not change. Multi-pass logic is encapsulated inside the proposer.

```
┌──────────────┐
│ Orchestrator │  emits crossref @ 0.6 (start)
└──────┬───────┘
       │
       │  ref_proposer.propose(title, channel, lyrics, frame_analyses)
       ▼
┌────────────────────────────────────────────────────────────┐
│ RefProposer                                                │
│                                                            │
│   1. Pass 1 — general                                      │
│      template: ref_proposer.md (revised)                   │
│      NIM call → list[ReferenceCandidate]  (~5s)            │
│                                                            │
│   2. types_covered = sorted({c.work_type for c in pass1})  │
│                                                            │
│   3. Pass 2 — complementary                                │
│      template: ref_proposer_complement.md (new)            │
│      ctx adds: types_covered                               │
│      NIM call → list[ReferenceCandidate]  (~5s)            │
│      (failure → log warning, skip; pass 1 still returned)  │
│                                                            │
│   4. Merge with case-insensitive dedup on                  │
│      (work_title, work_creator). Pass 1 wins ties.         │
│                                                            │
│   5. Return merged list[ReferenceCandidate]                │
└──────┬─────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────┐
│ Orchestrator │  emits crossref @ 0.7 (end)
└──────────────┘
```

Latency on the `crossref` step rises from ~5s (1 NIM call) to ~10s (2 sequential NIM calls). Acceptable per the user's brainstorming choice.

## Components

### `backend/app/pipeline/ref_proposer.py` — modified

`RefProposer.__init__` loads two prompt templates instead of one (`ref_proposer` and `ref_proposer_complement`).

`RefProposer.propose(...)` becomes:

```python
async def propose(self, *, title, channel, lyrics_text, frame_analyses):
    pass1 = await self._call(self._tpl_general, ctx={
        "title": title, "channel": channel,
        "lyrics": lyrics_text,
        "frame_summaries": _format_frame_summaries(frame_analyses),
    })

    types_covered = ", ".join(sorted({c.work_type for c in pass1})) or "(none)"

    try:
        pass2 = await self._call(self._tpl_complement, ctx={
            "title": title, "channel": channel,
            "lyrics": lyrics_text,
            "frame_summaries": _format_frame_summaries(frame_analyses),
            "types_covered": types_covered,
        })
    except Exception as e:
        logger.warning("ref_proposer pass 2 failed: %s — keeping pass 1 only", e)
        pass2 = []

    return _merge(pass1, pass2)
```

`_call(template, ctx)` is a small helper extracted from the existing `propose` body — formats the template, calls NIM, validates each candidate, returns `list[ReferenceCandidate]`. It keeps the existing `ValidationError` skip-and-debug-log behavior.

`_merge(pass1, pass2)` does case-insensitive dedup keyed on `(work_title, work_creator)`. Pass 1 entries always win on collision, so a stronger pass 1 candidate is not overridden by a weaker pass 2 duplicate.

### `backend/app/prompts/ref_proposer.md` — revised (existing file)

Four edits:

1. **Reorder the `work_type` enum** to `painting | photograph | music_video | film | album_cover | fashion_editorial | ad_campaign | archival_footage | other`. `film` is no longer first; non-film types come before. Counters the LLM anchor effect on the first option.
2. **Replace** the "If you have no confident named reference, return an empty list" rule with: "Aim for **5-8 candidates** when the frames support them. Empty list is acceptable only when no concrete visual evidence exists." This shifts the default from "return nothing if uncertain" to "return what is grounded".
3. **Add a diversity instruction**: "Prefer diversity of work_type when multiple plausible references exist — music video clips quote paintings, photographs, fashion editorials, and album covers as much as films."
4. **Add three canonical examples** spanning non-film types:
    - *Liberty Leading the People* by Delacroix (painting) — central raised figure with flag, smoke, fallen bodies.
    - *Identical Twins, Roselle, NJ* by Diane Arbus (photograph) — frontal symmetric framing of two identical subjects.
    - *Single Ladies* by Beyoncé / Jake Nava (music_video) — black-and-white studio, three dancers, locked synchronized hand positions.

The named-work, 3+-elements, and no-theme-only rules stay verbatim.

### `backend/app/prompts/ref_proposer_complement.md` — new

Receives the same context as pass 1 plus a `{types_covered}` placeholder. Tells the model to **avoid** the listed types and find candidates of any other type from the same enum. Same evidence rules (named work, 3+ concrete elements, no theme-only). Target: 3-5 candidates of uncovered types when supported. Empty list acceptable.

When pass 1 returned no candidates, `types_covered` is the literal string `(none)`; pass 2 then has no exclusion list and behaves as a permissive second attempt — a useful side-effect for hard clips.

### `backend/app/pipeline/orchestrator.py` — unchanged

The proposer hides multi-pass behind its existing API. The two existing `crossref` SSE events at progress 0.6 and 0.7 still bracket the entire step, which now takes ~10s instead of ~5s.

### `backend/app/pipeline/verifier.py` — unchanged

Pass 1 + pass 2 candidates flow into the same `verify_all` invocation. The verifier's parallelism (`asyncio.gather` + NIM concurrency=4) absorbs 8-12 candidates in ~5-10s, same envelope as today's 0-5.

### Frontend — unchanged

The `VerifiedReference` shape on the wire is unchanged (`work_type` is already `string`). The reference card renders any string value via the existing layout. New types like `fashion_editorial` display as `fashion_editorial` until/unless the frontend formats them prettier — out of scope for this spec.

## Data flow

| Step | Input | Output |
|---|---|---|
| Pass 1 NIM call | title, channel, lyrics, frame_summaries | candidates_1: `list[ReferenceCandidate]` (target 5-8) |
| Compute types_covered | candidates_1 | `"film, painting"` (joined sorted set) or `"(none)"` if empty |
| Pass 2 NIM call | title, channel, lyrics, frame_summaries, types_covered | candidates_2: `list[ReferenceCandidate]` (target 3-5 of other types) |
| Merge | candidates_1, candidates_2 | merged: dedup'd list, target 8-12 |
| → Verifier (existing) | merged | verified: `list[VerifiedReference]` |

## Error handling

| Failure mode | Behavior |
|---|---|
| Pass 1 NIM raises (5xx persistent after retries) | Exception propagates to orchestrator → existing `error` SSE event. Same as today. |
| Pass 2 NIM raises | Caught inside proposer; logged at WARNING. Pass 1 candidates returned alone. Pipeline continues. |
| Pass 1 returns empty | Pass 2 still runs with `types_covered="(none)"` — permissive. |
| Both passes empty | Merged list empty. Verifier sees nothing. Orchestrator emits `done` with 0 references. Same as today's degenerate path. |
| Individual candidate `ValidationError` (e.g., missing field, bad enum) | Skipped with debug log inside `_call` helper. Existing behavior. |
| Duplicate candidates (case-insensitive title+creator) | Dedup'd; pass 1 wins ties to preserve the more general pass's confidence/timestamp. |

## Testing

Unit tests in `backend/tests/unit/test_ref_proposer.py`, NIM mocked with `respx`. The existing single-pass test is updated to assert the two-pass flow (rather than duplicated).

| Test | Assertion |
|---|---|
| `test_propose_runs_two_passes` | NIM `route.call_count == 2`. The two requests render two distinct templates (pass 1 has no `types_covered`, pass 2 does). |
| `test_pass2_receives_pass1_types_covered` | Pass 1 mocked to return candidates with types `[film, photograph]`. Inspect pass 2 request body, assert it contains `"film, photograph"`. |
| `test_merge_dedups_case_insensitive` | Pass 1: `("Suspiria", "Dario Argento")`. Pass 2: `("SUSPIRIA", "dario argento")`. Result: 1 candidate, pass 1's fields preserved. |
| `test_pass2_failure_returns_pass1_only` | Pass 1 returns 3 candidates. Pass 2 mock raises (e.g., 502 after retries). `propose()` returns 3 candidates, no exception. WARNING logged. |
| `test_pass1_empty_pass2_still_runs` | Pass 1 returns `{candidates: []}`. Assert pass 2 is still called and `types_covered` is `(none)`. If pass 2 returns 2 candidates, result has 2. |
| `test_both_passes_empty_returns_empty` | No candidates from either pass. `propose()` returns `[]`, no exception. |

No frontend tests required (the wire contract is unchanged).

### Manual verification (post-implementation)

After the unit suite passes:

1. Reset DB.
2. Re-analyze the 5 known clips: `Vl-GJaitlNs`, `dvgZkm1xWPE`, `0KUf9U7e-VI`, `URDPBG-vz3I`, `4y4M-uTkdC0`.
3. Pass criteria:
   - Coldplay/Viva La Vida (`dvgZkm1xWPE`) surfaces ≥ 1 candidate of type `painting` (Delacroix expected).
   - Pinkman (`0KUf9U7e-VI`) surfaces ≥ 1 candidate (vs. 0 today).
   - Mean total references across the 5 clips lands in **8-12** (user target).
   - Across the 5 clips combined, ≥ 3 distinct `work_type` values surface.

If any pass-criterion fails after the prompt-only iteration, the next escalation in the brainstorming was option C (type-aware fan-out) — that's deferred until evidence shows the prompt fix is insufficient.

## Open questions

None at design time.

## Rollout

Single PR. Changes are backward-compatible: the public `RefProposer.propose(...)` API is unchanged, the wire format is unchanged, the DB schema is unchanged. Existing reports are not invalidated; new analyses use the new prompt path.

A revert is one git revert away; no data migration to undo.
