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
