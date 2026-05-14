# Reference Detail v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-page YouTube player to the reference detail page, prefer FR labels over EN when enriching from Wikidata, and route enrichment through a per-`work_type` Wikidata property table so films/music_videos/etc. get sensible `medium`/`institution`/`inception_year`.

**Architecture:** All changes land in 4 files (2 backend, 2 frontend) plus their tests. No Pydantic model change, no DB migration, no API surface change. The `VideoPlayer` component is reused as-is. The `WikidataEnricher` gains an internal dispatch dict + a label-language fallback.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy / httpx / respx (backend) · Next.js 15 App Router / React 19 / TypeScript / Vitest + Testing Library + happy-dom (frontend).

**Spec:** `docs/superpowers/specs/2026-05-14-reference-detail-v2-design.md`

---

## File Structure

**Backend**

| Path | Responsibility | Action |
| --- | --- | --- |
| `backend/app/pipeline/wikidata_enricher.py` | Adds `_PROPS_BY_WORK_TYPE` config table + per-work_type property selection; switches label fetch to `?languages=fr\|en` with FR-then-EN fallback | Modify |
| `backend/tests/unit/test_wikidata_enricher.py` | Existing tests adjusted for new behavior + new tests for work_type dispatch + multilingual fallback | Modify |

**Frontend**

| Path | Responsibility | Action |
| --- | --- | --- |
| `frontend/components/report/detail/DetailCompare.tsx` | Left pane mounts `<VideoPlayer ref=playerRef>` and calls `seekTo` on mount/timestamp change instead of rendering a static `<img>` | Modify |
| `frontend/components/report/detail/DetailCompare.test.tsx` | Mock `@/components/VideoPlayer`; add tests asserting `seekTo` calls; remove/update assertions that depended on the left-pane `<img>` | Modify |
| `frontend/components/report/detail/DetailTopRow.tsx` | Drops the `onJump` prop and the JUMP button | Modify |
| `frontend/components/report/detail/ReferenceDetail.tsx` | Drops `handleJump` + `onJump={...}` (no longer used) | Modify |

---

## Task 1: Backend — Per-`work_type` Wikidata property dispatch

**Files:**
- Modify: `backend/app/pipeline/wikidata_enricher.py`
- Modify: `backend/tests/unit/test_wikidata_enricher.py`

### Step 1: Update the `_ref` test helper to take a `work_type` parameter

The helper currently hard-codes `work_type="painting"`. Make it a parameter so the new tests can build film/music_video refs.

- [ ] **Step 1: Modify `_ref` in `backend/tests/unit/test_wikidata_enricher.py`**

Replace the existing helper (around line 90):

```python
def _ref(
    wiki_url: str | None = "https://en.wikipedia.org/wiki/Le_faux_miroir",
    work_type: str = "painting",
) -> VerifiedReference:
    return VerifiedReference(
        timestamp_s=42.0,
        source_frame_id="shot_03",
        work_title="Le faux miroir",
        work_creator="René Magritte",
        work_year=1929,
        work_type=work_type,
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
```

### Step 2: Re-target the two existing P577/P272 tests to use `work_type="film"`

These tests are conceptually about film fallbacks but use a painting ref because no dispatch existed. After Task 1, painting only tries P571/P276 — so these tests must use `work_type="film"` to exercise P577/P272.

- [ ] **Step 2: Update `test_falls_back_to_p577_for_films`**

Change the `enricher.enrich([_ref()])` call to `enricher.enrich([_ref(work_type="film")])`.

- [ ] **Step 3: Update `test_falls_back_to_p272_for_film_institution`**

Change the `enricher.enrich([_ref()])` call to `enricher.enrich([_ref(work_type="film")])`.

### Step 3: Write the new failing tests for the dispatch

- [ ] **Step 4: Add `test_film_uses_p136_p272_p577_together` at the end of the file**

```python
@respx.mock
async def test_film_uses_p136_p272_p577_together():
    """For work_type='film', the enricher reads P136 (genre→medium),
    P272 (production company→institution), P577 (publication date→year)."""
    respx.get("https://en.wikipedia.org/w/api.php").mock(
        return_value=Response(200, json={
            "query": {"pages": {"123": {"pageprops": {"wikibase_item": "Q83495"}}}}
        })
    )
    respx.get(
        "https://www.wikidata.org/wiki/Special:EntityData/Q83495.json"
    ).mock(return_value=Response(200, json={
        "entities": {"Q83495": {"claims": {
            "P136": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q500"}}}}],
            "P272": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q42"}}}}],
            "P577": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"time": "+1979-05-25T00:00:00Z"}}}}],
        }}}
    }))
    respx.get("https://www.wikidata.org/w/api.php").mock(
        return_value=Response(200, json={"entities": {
            "Q500": {"labels": {"en": {"value": "science fiction film"}}},
            "Q42":  {"labels": {"en": {"value": "Mosfilm"}}},
        }})
    )
    enricher = WikidataEnricher(concurrency=2)
    out = await enricher.enrich([_ref(work_type="film")])
    assert out[0].medium == "science fiction film"
    assert out[0].institution == "Mosfilm"
    assert out[0].inception_year == 1979
```

- [ ] **Step 5: Add `test_music_video_uses_p264_for_label`**

```python
@respx.mock
async def test_music_video_uses_p264_for_label():
    """For work_type='music_video', institution comes from P264 (record label)."""
    respx.get("https://en.wikipedia.org/w/api.php").mock(
        return_value=Response(200, json={
            "query": {"pages": {"123": {"pageprops": {"wikibase_item": "Q1"}}}}
        })
    )
    respx.get(
        "https://www.wikidata.org/wiki/Special:EntityData/Q1.json"
    ).mock(return_value=Response(200, json={
        "entities": {"Q1": {"claims": {
            "P264": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q888"}}}}],
        }}}
    }))
    respx.get("https://www.wikidata.org/w/api.php").mock(
        return_value=Response(200, json={"entities": {
            "Q888": {"labels": {"en": {"value": "DGC Records"}}},
        }})
    )
    enricher = WikidataEnricher(concurrency=2)
    out = await enricher.enrich([_ref(work_type="music_video")])
    assert out[0].institution == "DGC Records"
```

- [ ] **Step 6: Add `test_unknown_work_type_uses_painting_defaults`**

```python
@respx.mock
async def test_unknown_work_type_uses_painting_defaults():
    """Unknown work_type → falls back to painting's P186/P276/P571 mapping."""
    respx.get("https://en.wikipedia.org/w/api.php").mock(
        return_value=Response(200, json={
            "query": {"pages": {"123": {"pageprops": {"wikibase_item": "Q1"}}}}
        })
    )
    respx.get(
        "https://www.wikidata.org/wiki/Special:EntityData/Q1.json"
    ).mock(return_value=Response(200, json={
        "entities": {"Q1": {"claims": {
            "P186": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q300"}}}}],
        }}}
    }))
    respx.get("https://www.wikidata.org/w/api.php").mock(
        return_value=Response(200, json={"entities": {
            "Q300": {"labels": {"en": {"value": "oil on canvas"}}},
        }})
    )
    enricher = WikidataEnricher(concurrency=2)
    out = await enricher.enrich([_ref(work_type="unrecognized_thing")])
    assert out[0].medium == "oil on canvas"
```

- [ ] **Step 7: Run the failing tests — should all fail**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_wikidata_enricher.py -v 2>&1 | tail -30`

Expected: at least the 3 new tests fail (mostly with `medium is None` because the current code only reads P186/P276/P571). The two re-pointed film tests also fail for the same reason.

### Step 4: Implement the dispatch table + helpers

- [ ] **Step 8: Add the config table and two new helpers to `backend/app/pipeline/wikidata_enricher.py`**

Insert near the top of the file, right after the existing `_RANK_ORDER`/`_extract_slug`/`_select_claim`/`_parse_inception_year` helpers (around line 63):

```python
# Per-work_type Wikidata property dispatch. Each work_type names an
# ordered list of property codes per output field. The enricher walks
# the list in order and stops at the first non-null claim. Unknown
# work_types fall back to `_DEFAULT_PROPS` (painting).
#
# P31  instance-of      | P136 genre              | P186 material/medium
# P264 record label     | P272 production company | P276 location
# P123 publisher        | P1056 product           | P1433 published in
# P571 inception        | P577 publication date
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

- [ ] **Step 9: Refactor `_enrich_one` to use the dispatch**

Replace the existing body of `_enrich_one` (lines ~141–176) with:

```python
    async def _enrich_one(
        self, http: httpx.AsyncClient, r: VerifiedReference
    ) -> VerifiedReference:
        slug = _extract_slug(r.wikipedia_url)
        if slug is None:
            return r
        qid = await self._fetch_qid(http, slug)
        if qid is None:
            return r
        claims = await self._fetch_claims(http, qid)
        if claims is None:
            return r

        props = _PROPS_BY_WORK_TYPE.get(r.work_type, _DEFAULT_PROPS)
        medium_qid = self._first_claim_qid(claims, props["medium"])
        institution_qid = self._first_claim_qid(claims, props["institution"])
        inception = self._first_inception(claims, props["inception"])

        labels_to_resolve = [q for q in (medium_qid, institution_qid) if q]
        labels = (
            await self._resolve_labels(http, labels_to_resolve)
            if labels_to_resolve
            else {}
        )
        return r.model_copy(update={
            "medium": labels.get(medium_qid) if medium_qid else None,
            "institution": labels.get(institution_qid) if institution_qid else None,
            "inception_year": inception,
        })

    def _first_claim_qid(
        self, claims: dict[str, list], p_codes: list[str]
    ) -> str | None:
        for p in p_codes:
            qid = self._claim_qid(claims.get(p, []))
            if qid:
                return qid
        return None

    def _first_inception(
        self, claims: dict[str, list], p_codes: list[str]
    ) -> int | None:
        for p in p_codes:
            v = self._claim_inception(claims.get(p, []))
            if v is not None:
                return v
        return None
```

The old `_claim_qid` and `_claim_inception` helpers stay as-is — they're called by the two new methods.

### Step 5: Verify and commit

- [ ] **Step 10: Run the full enricher test file**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_wikidata_enricher.py -v 2>&1 | tail -30`

Expected: all enricher tests pass (the original 14 + 3 new = 17).

- [ ] **Step 11: Run the full backend suite for regression**

Run: `docker exec clip-decoder-backend-1 python -m pytest -q --ignore=tests/integration/test_e2e.py 2>&1 | tail -5`

Expected: `88 passed` (was 85, +3 new tests).

- [ ] **Step 12: Commit**

```bash
git add backend/app/pipeline/wikidata_enricher.py backend/tests/unit/test_wikidata_enricher.py
git commit -m "feat(enricher): per-work_type Wikidata property dispatch

Replace ad-hoc P276→P272 and P571→P577 inline fallbacks with a
single _PROPS_BY_WORK_TYPE config table keyed on the reference's
work_type. Films now read genre/production-company/publication-date,
music_videos read instance-of/record-label/publication-date, etc.
Unknown work_types fall back to painting's mapping."
```

---

## Task 2: Backend — Wikidata label FR → EN fallback

**Files:**
- Modify: `backend/app/pipeline/wikidata_enricher.py`
- Modify: `backend/tests/unit/test_wikidata_enricher.py`

### Step 1: Write failing tests

- [ ] **Step 1: Add `test_label_prefers_fr_over_en` at the end of `test_wikidata_enricher.py`**

```python
@respx.mock
async def test_label_prefers_fr_over_en():
    """When wbgetentities returns both fr and en labels, the enricher stores fr."""
    respx.get("https://en.wikipedia.org/w/api.php").mock(
        return_value=Response(200, json={
            "query": {"pages": {"123": {"pageprops": {"wikibase_item": "Q123"}}}}
        })
    )
    respx.get(
        "https://www.wikidata.org/wiki/Special:EntityData/Q123.json"
    ).mock(return_value=Response(200, json={
        "entities": {"Q123": {"claims": {
            "P186": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q300"}}}}],
        }}}
    }))
    respx.get("https://www.wikidata.org/w/api.php").mock(
        return_value=Response(200, json={"entities": {
            "Q300": {"labels": {
                "fr": {"value": "huile sur toile"},
                "en": {"value": "oil on canvas"},
            }},
        }})
    )
    enricher = WikidataEnricher(concurrency=2)
    out = await enricher.enrich([_ref()])
    assert out[0].medium == "huile sur toile"
```

- [ ] **Step 2: Add `test_label_falls_back_to_en_when_fr_missing`**

```python
@respx.mock
async def test_label_falls_back_to_en_when_fr_missing():
    """When wbgetentities only returns en, the enricher stores en."""
    respx.get("https://en.wikipedia.org/w/api.php").mock(
        return_value=Response(200, json={
            "query": {"pages": {"123": {"pageprops": {"wikibase_item": "Q123"}}}}
        })
    )
    respx.get(
        "https://www.wikidata.org/wiki/Special:EntityData/Q123.json"
    ).mock(return_value=Response(200, json={
        "entities": {"Q123": {"claims": {
            "P186": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q300"}}}}],
        }}}
    }))
    respx.get("https://www.wikidata.org/w/api.php").mock(
        return_value=Response(200, json={"entities": {
            "Q300": {"labels": {"en": {"value": "oil on canvas"}}},
        }})
    )
    enricher = WikidataEnricher(concurrency=2)
    out = await enricher.enrich([_ref()])
    assert out[0].medium == "oil on canvas"
```

- [ ] **Step 3: Run — both new tests should fail**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_wikidata_enricher.py::test_label_prefers_fr_over_en backend/tests/unit/test_wikidata_enricher.py::test_label_falls_back_to_en_when_fr_missing -v 2>&1 | tail -20`

Expected: `test_label_prefers_fr_over_en` fails (returns `"oil on canvas"`), `test_label_falls_back_to_en_when_fr_missing` already passes (en is what's fetched today, so the assertion accidentally holds).

### Step 2: Implement the FR→EN fallback

- [ ] **Step 4: Modify `_resolve_labels` in `backend/app/pipeline/wikidata_enricher.py`**

Replace the existing method (around line 225) with:

```python
    async def _resolve_labels(
        self, http: httpx.AsyncClient, qids: list[str]
    ) -> dict[str, str]:
        if not qids:
            return {}
        r = await http.get(_WIKIDATA_API, params={
            "action": "wbgetentities",
            "ids": "|".join(qids),
            "props": "labels",
            "languages": "fr|en",
            "format": "json",
        })
        if r.status_code != 200:
            return {}
        out: dict[str, str] = {}
        entities = (r.json().get("entities") or {})
        for qid, entity in entities.items():
            labels = entity.get("labels") or {}
            fr = (labels.get("fr") or {}).get("value")
            en = (labels.get("en") or {}).get("value")
            label = fr or en
            if label:
                out[qid] = label
        return out
```

### Step 3: Verify and commit

- [ ] **Step 5: Run the full enricher test file**

Run: `docker exec clip-decoder-backend-1 python -m pytest backend/tests/unit/test_wikidata_enricher.py -v 2>&1 | tail -25`

Expected: all 19 tests pass (17 from Task 1 + 2 new).

- [ ] **Step 6: Run the full backend suite**

Run: `docker exec clip-decoder-backend-1 python -m pytest -q --ignore=tests/integration/test_e2e.py 2>&1 | tail -5`

Expected: `90 passed`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/pipeline/wikidata_enricher.py backend/tests/unit/test_wikidata_enricher.py
git commit -m "feat(enricher): prefer French Wikidata labels with English fallback

_resolve_labels now requests ?languages=fr|en and picks fr if
present, en otherwise. Model and DB unchanged — still one string
per field."
```

---

## Task 3: Frontend — DetailCompare swaps left-pane `<img>` for the in-page `VideoPlayer`

**Files:**
- Modify: `frontend/components/report/detail/DetailCompare.tsx`
- Modify: `frontend/components/report/detail/DetailCompare.test.tsx`

### Step 1: Mock VideoPlayer in the test file + write failing tests

- [ ] **Step 1: Add a `VideoPlayer` mock at the top of `DetailCompare.test.tsx`**

Insert this block immediately after the existing `import` lines (right before `const fa:`):

```tsx
import { vi } from "vitest";

// Mock VideoPlayer so the test does not load a YouTube iframe.
// Mirrors the pattern in components/report/ReportContent.test.tsx.
vi.mock("@/components/VideoPlayer", () => {
  const React = require("react");
  return {
    VideoPlayer: React.forwardRef((props: { youtubeId: string }, ref: any) => {
      const handle = { seekTo: vi.fn() };
      React.useImperativeHandle(ref, () => handle);
      (globalThis as any).__lastSeekTo = handle.seekTo;
      (globalThis as any).__lastYoutubeId = props.youtubeId;
      return null;
    }),
  };
});
```

Also extend the top-of-file imports to add `beforeEach`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
```

And add a `beforeEach` resetting the spies right after the existing `baseRef` const (around line 39):

```tsx
beforeEach(() => {
  (globalThis as any).__lastSeekTo = vi.fn();
  (globalThis as any).__lastYoutubeId = undefined;
});
```

- [ ] **Step 2: Replace the existing "renders the wikipedia thumbnail when present" test**

This test counted both panes' `<img>` elements. After the change, only the right pane has an `<img>`. Update it to assert the right-pane img directly and that VideoPlayer mounted with the correct youtubeId:

```tsx
  it("renders the wikipedia thumbnail in the right pane", () => {
    render(<DetailCompare reference={baseRef} frame={fa} youtubeId="abc" frameIndex={0} />);
    const thumb = screen.getByAltText("Le faux miroir");
    expect(thumb.getAttribute("src")).toBe("https://upload.wikimedia.org/foo.jpg");
  });

  it("mounts VideoPlayer in the left pane with the report's youtubeId", () => {
    render(<DetailCompare reference={baseRef} frame={fa} youtubeId="abc" frameIndex={0} />);
    expect((globalThis as any).__lastYoutubeId).toBe("abc");
  });
```

- [ ] **Step 3: Add new tests for seekTo timing**

Append inside the `describe("DetailCompare", ...)` block:

```tsx
  it("calls VideoPlayer.seekTo with reference.timestamp_s on mount", async () => {
    render(
      <DetailCompare
        reference={{ ...baseRef, timestamp_s: 42.5 }}
        frame={fa}
        youtubeId="abc"
        frameIndex={0}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect((globalThis as any).__lastSeekTo).toHaveBeenCalledWith(42.5);
  });

  it("re-calls seekTo when the reference's timestamp_s changes", async () => {
    const { rerender } = render(
      <DetailCompare
        reference={{ ...baseRef, timestamp_s: 42.5 }}
        frame={fa}
        youtubeId="abc"
        frameIndex={0}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    (globalThis as any).__lastSeekTo.mockClear();
    rerender(
      <DetailCompare
        reference={{ ...baseRef, timestamp_s: 88.0 }}
        frame={fa}
        youtubeId="abc"
        frameIndex={0}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect((globalThis as any).__lastSeekTo).toHaveBeenCalledWith(88.0);
  });
```

- [ ] **Step 4: Run — the new tests should fail (the component doesn't mount VideoPlayer yet)**

Run: `docker exec clip-decoder-frontend-1 npx vitest run components/report/detail/DetailCompare.test.tsx 2>&1 | tail -20`

Expected: `__lastYoutubeId` is `undefined` and `__lastSeekTo` was never called → 3 of the 5 tests fail (the placeholder + sub-line tests still pass).

### Step 2: Update `DetailCompare.tsx` to use VideoPlayer in the left pane

- [ ] **Step 5: Edit `frontend/components/report/detail/DetailCompare.tsx`**

Replace the whole file with:

```tsx
"use client";
import { useEffect, useRef } from "react";
import type { FrameAnalysis, VerifiedReference } from "@/lib/types";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";

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
  frameIndex: number;
}) {
  const tc = formatTimecode(reference.timestamp_s);
  const shotId = reference.source_frame_id.toUpperCase();
  const compositionShort = truncate(frame?.composition, 60);

  const playerRef = useRef<VideoPlayerHandle>(null);
  useEffect(() => {
    // Seek every time the timestamp changes (prev/next navigation
    // re-renders this component without remounting the iframe).
    playerRef.current?.seekTo(reference.timestamp_s);
  }, [reference.timestamp_s]);

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
          <VideoPlayer ref={playerRef} youtubeId={youtubeId} />
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
              alt={reference.work_title}
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

The diff vs the existing file is: drop the `<img src={`/api/frames/...`}>` block and replace with `<VideoPlayer ref={playerRef} youtubeId={youtubeId} />`; add the `useRef` + `useEffect` near the top of the component body; import `useEffect`/`useRef`/`VideoPlayer`/`VideoPlayerHandle`.

**No CSS change is needed.** `.detail-pane .img` in `frontend/app/globals.css` already declares `aspect-ratio: 16/9` (line 1760), and `VideoPlayer`'s outer `<div>` also sets `aspectRatio: "16/9"` inline. The iframe gets its height immediately on first paint.

### Step 3: Verify and commit

- [ ] **Step 6: Run the DetailCompare test file**

Run: `docker exec clip-decoder-frontend-1 npx vitest run components/report/detail/DetailCompare.test.tsx 2>&1 | tail -15`

Expected: all 5 tests pass.

- [ ] **Step 7: Run the full frontend suite to catch regressions**

Run: `docker exec clip-decoder-frontend-1 npx vitest run 2>&1 | tail -8`

Expected: 38 tests pass (3 DetailCompare tests grew to 6 — replaced "renders the wikipedia thumbnail when present" with two new tests and appended two `seekTo` tests).

- [ ] **Step 8: Commit**

```bash
git add frontend/components/report/detail/DetailCompare.tsx frontend/components/report/detail/DetailCompare.test.tsx
git commit -m "feat(frontend): in-page VideoPlayer on the reference detail page

The left pane of DetailCompare now mounts the existing VideoPlayer
auto-seeked to reference.timestamp_s, instead of rendering a static
frame thumbnail. Prev/next navigation re-seeks the same iframe via
useEffect rather than remounting it."
```

---

## Task 4: Frontend — Drop the JUMP button from DetailTopRow

**Files:**
- Modify: `frontend/components/report/detail/DetailTopRow.tsx`
- Modify: `frontend/components/report/detail/ReferenceDetail.tsx`

### Step 1: Drop the prop + button from DetailTopRow

- [ ] **Step 1: Replace `frontend/components/report/detail/DetailTopRow.tsx`**

```tsx
"use client";
import type { VerifiedReference } from "@/lib/types";

const VERDICT_DOT: Record<string, string> = {
  confirmed: "var(--grad-peach)",
  speculative: "var(--grad-sky)",
  hidden: "var(--muted)",
};

export function DetailTopRow({
  reference,
}: {
  reference: VerifiedReference;
}) {
  const verdictLabel = reference.final_confidence.toUpperCase();
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
    </div>
  );
}
```

Diff vs existing: drop `onJump` from the prop type, drop `formatTimecode` (no longer used here), drop the entire `<div className="detail-top-actions"> ... </div>` block.

### Step 2: Drop the parent's `handleJump` + prop passing

- [ ] **Step 2: Edit `frontend/components/report/detail/ReferenceDetail.tsx`**

Remove the `handleJump` function and the `onJump={handleJump}` attribute. The relevant slice of the file (around lines 33–46) becomes:

```tsx
  return (
    <main className="frame surface-dark relative min-h-screen flex flex-col">
      <DetailSlate
        youtubeId={youtubeId}
        reference={reference}
        index={index}
        total={total}
      />
      <div className="detail">
        <DetailTopRow reference={reference} />
        <DetailCompare
          reference={reference}
          frame={frame}
          youtubeId={youtubeId}
          frameIndex={index}
        />
```

The `useRouter()` call and `router` variable can also be deleted from this file since `handleJump` was the only consumer. Remove the `import { useRouter } from "next/navigation";` line at the top as well.

### Step 3: Verify and commit

- [ ] **Step 3: TypeScript check**

Run: `docker exec clip-decoder-frontend-1 npx tsc --noEmit 2>&1 | tail -10`

Expected: no errors (any old code calling `DetailTopRow` with `onJump` would fail here).

- [ ] **Step 4: Run the full frontend test suite**

Run: `docker exec clip-decoder-frontend-1 npx vitest run 2>&1 | tail -8`

Expected: 38 tests pass (unchanged from Task 3 — this task removes JSX that has no dedicated test coverage).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/report/detail/DetailTopRow.tsx frontend/components/report/detail/ReferenceDetail.tsx
git commit -m "feat(frontend): drop JUMP button from DetailTopRow

The in-page VideoPlayer makes the JUMP-back-to-report-and-seek
button redundant on the detail page. The button on the report
page's ReferenceCard is unaffected."
```

---

## Task 5: End-to-end smoke

**Files:** none modified — verification only.

### Step 1: Run both test suites

- [ ] **Step 1: Backend regression**

Run: `docker exec clip-decoder-backend-1 python -m pytest -q --ignore=tests/integration/test_e2e.py 2>&1 | tail -5`

Expected: `90 passed`.

- [ ] **Step 2: Frontend regression**

Run: `docker exec clip-decoder-frontend-1 npx vitest run 2>&1 | tail -5`

Expected: `Test Files  11 passed (11)`, `Tests  38 passed (38)`.

### Step 2: Manual smoke in the browser

- [ ] **Step 3: Seed a fresh fixture report**

Run: `docker exec -i clip-decoder-backend-1 python < /home/louis/clip-decoder/backend/scripts/seed_fixture.py 2>&1 | tail -1`

Expected: `Seeded fixture report at /report/BtyHYIpykN0`.

- [ ] **Step 4: Open the detail page in a browser**

URL: `http://localhost:3000/report/BtyHYIpykN0/ref/3` (index 3 = the Stalker fixture, work_type=film)

Visually verify:
- The left pane shows a YouTube iframe for the PNL clip, parked at ≈ `24s` (= `3 × 8s` per the fixture).
- No JUMP button is visible in the top row.
- The right pane still shows the Wikipedia thumbnail + work title + metadata.
- Hitting → on the keyboard advances to ref/4 and the iframe re-seeks (not remounts).

- [ ] **Step 5: Verify the JUMP button is still on the report grid**

URL: `http://localhost:3000/report/BtyHYIpykN0`

Each `ReferenceCard` still has a `▸ JUMP TO` button. Clicking it seeks the inline player on the report page (unaffected by this change).

- [ ] **Step 6: (Optional) Re-run an analysis on a film clip to exercise the new Wikidata dispatch**

Only worth doing if you have a NIM endpoint reachable. Otherwise the unit tests cover the dispatch logic.

---
