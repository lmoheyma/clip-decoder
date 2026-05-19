from __future__ import annotations
import asyncio
import logging
import urllib.parse
from typing import Awaitable, Callable
import httpx
from app.models import (
    Confidence,
    FrameAnalysis,
    ReferenceCandidate,
    Verdict,
    VerifiedReference,
)
from app.nim.client import NimClient
from app.prompts.loader import load_prompt

logger = logging.getLogger(__name__)


WIKI_SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/{slug}"
WIKI_USER_AGENT = (
    "clip-decoder/0.1 (+https://github.com/lmoheyma/clip-decoder)"
)


class Verifier:
    def __init__(
        self,
        nim_client: NimClient,
        model: str,
        wikipedia: bool = True,
        concurrency: int = 4,
    ):
        self._nim = nim_client
        self._model = model
        self._wiki = wikipedia
        self._sem = asyncio.Semaphore(concurrency)
        self._template = load_prompt("verifier")

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

    def _bucket(self, verdict: Verdict, wiki_url: str | None) -> Confidence:
        if verdict is Verdict.REJECT:
            return Confidence.HIDDEN
        if verdict is Verdict.SPECULATIVE:
            return Confidence.SPECULATIVE
        # verdict == KEEP
        if self._wiki and wiki_url is None:
            return Confidence.SPECULATIVE
        return Confidence.CONFIRMED

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

    async def verify(
        self,
        candidate: ReferenceCandidate,
        frame_index: dict[str, FrameAnalysis],
    ) -> VerifiedReference:
        return await self._verify_one(candidate, frame_index)

    async def verify_all(
        self,
        candidates: list[ReferenceCandidate],
        frame_index: dict[str, FrameAnalysis],
        on_progress: Callable[[str, float], Awaitable[None]] | None = None,
        on_candidate: Callable[[VerifiedReference], Awaitable[None]] | None = None,
    ) -> list[VerifiedReference]:
        # return_exceptions=True so a single transient failure (e.g. NIM
        # 5xx that exhausted its retries) doesn't drop every successfully
        # verified reference. Failed verifications are logged and skipped.
        total = len(candidates)
        completed = 0
        lock = asyncio.Lock()

        async def _wrapped(c: ReferenceCandidate) -> VerifiedReference:
            nonlocal completed
            res = await self._verify_one(c, frame_index)
            async with lock:
                completed += 1
                if on_progress:
                    # Progress band for verify is 0.75 -> 1.0 (25%); each
                    # candidate moves us linearly across it.
                    p = 0.75 + (completed / max(total, 1)) * 0.25
                    bucket = res.final_confidence.value
                    await on_progress(
                        f"Verified {completed}/{total} · "
                        f"{res.work_title} → {bucket}",
                        p,
                    )
                if on_candidate:
                    await on_candidate(res)
            return res

        results = await asyncio.gather(
            *(_wrapped(c) for c in candidates),
            return_exceptions=True,
        )
        verified: list[VerifiedReference] = []
        for cand, res in zip(candidates, results):
            if isinstance(res, BaseException):
                logger.warning(
                    "verifier failed for candidate %r: %s",
                    cand.work_title, res,
                )
                if on_progress:
                    await on_progress(
                        f"Verify failed for {cand.work_title}: {res}", 0.0,
                    )
                continue
            verified.append(res)
        return verified
