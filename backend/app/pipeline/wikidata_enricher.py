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


import asyncio
from typing import Awaitable, Callable
import httpx
from app.models import VerifiedReference
from app.pipeline.verifier import WIKI_USER_AGENT


_WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
_WIKIDATA_ENTITY = "https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
_WIKIDATA_API = "https://www.wikidata.org/w/api.php"


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
    "other":             {"medium": ["P186", "P31"], "institution": ["P276", "P123"], "inception": ["P577", "P571"]},
}
_DEFAULT_PROPS = _PROPS_BY_WORK_TYPE["painting"]


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

        async def _wrapped(http: httpx.AsyncClient, r: VerifiedReference) -> VerifiedReference:
            nonlocal completed
            try:
                out = await self._enrich_one(http, r)
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
            # http is passed through every helper so two concurrent enrich()
            # calls on the same enricher instance can't collide on shared state.
            results = await asyncio.gather(
                *(self._sem_wrap(_wrapped(http, r)) for r in refs),
                return_exceptions=False,
            )
        return list(results)

    async def _sem_wrap(self, coro: Awaitable[VerifiedReference]) -> VerifiedReference:
        async with self._sem:
            return await coro

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

    async def _fetch_qid(self, http: httpx.AsyncClient, slug: str) -> str | None:
        r = await http.get(_WIKIPEDIA_API, params={
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

    async def _fetch_claims(
        self, http: httpx.AsyncClient, qid: str
    ) -> dict[str, list] | None:
        r = await http.get(_WIKIDATA_ENTITY.format(qid=qid))
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

    async def _resolve_labels(
        self, http: httpx.AsyncClient, qids: list[str]
    ) -> dict[str, str]:
        if not qids:
            return {}
        r = await http.get(_WIKIDATA_API, params={
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
