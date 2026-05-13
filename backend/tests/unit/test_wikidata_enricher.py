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
