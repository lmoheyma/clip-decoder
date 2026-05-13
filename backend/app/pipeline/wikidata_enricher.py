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
