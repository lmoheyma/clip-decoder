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
    # Also mock wikidata.org/w/api.php for wbgetentities calls
    respx.get("https://www.wikidata.org/w/api.php").mock(
        return_value=Response(200, json={
            "entities": {"Q300": {"labels": {"en": {"value": "oil on canvas"}}}},
        })
    )
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


@respx.mock
async def test_falls_back_to_p577_for_films():
    # Films/music videos have P577 (publication date) instead of P571
    # (inception). The enricher should pick up either property.
    respx.get("https://en.wikipedia.org/w/api.php").mock(
        side_effect=[
            Response(200, json={
                "query": {"pages": {"123": {"pageprops": {"wikibase_item": "Q83495"}}}}
            }),
            Response(200, json={"entities": {}}),
        ]
    )
    respx.get(
        "https://www.wikidata.org/wiki/Special:EntityData/Q83495.json"
    ).mock(return_value=Response(200, json={
        "entities": {"Q83495": {"claims": {
            "P577": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"time": "+1999-03-31T00:00:00Z"}}}}],
        }}}
    }))
    enricher = WikidataEnricher(concurrency=2)
    out = await enricher.enrich([_ref(work_type="film")])
    assert out[0].inception_year == 1999
    assert out[0].medium is None
    assert out[0].institution is None


@respx.mock
async def test_falls_back_to_p272_for_film_institution():
    # Films have P272 (production company) where artworks have P276 (location).
    respx.get("https://en.wikipedia.org/w/api.php").mock(
        return_value=Response(200, json={
            "query": {"pages": {"123": {"pageprops": {"wikibase_item": "Q83495"}}}}
        })
    )
    respx.get(
        "https://www.wikidata.org/wiki/Special:EntityData/Q83495.json"
    ).mock(return_value=Response(200, json={
        "entities": {"Q83495": {"claims": {
            "P272": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "Q42"}}}}],
        }}}
    }))
    respx.get("https://www.wikidata.org/w/api.php").mock(
        return_value=Response(200, json={
            "entities": {"Q42": {"labels": {"en": {"value": "Warner Bros."}}}}
        })
    )
    enricher = WikidataEnricher(concurrency=2)
    out = await enricher.enrich([_ref(work_type="film")])
    assert out[0].institution == "Warner Bros."


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


@respx.mock
async def test_painting_does_not_pick_up_p577():
    """Regression: paintings consult only P571 for inception. A claims
    payload containing P577 (but no P571) must leave inception_year=None."""
    respx.get("https://en.wikipedia.org/w/api.php").mock(
        return_value=Response(200, json={
            "query": {"pages": {"123": {"pageprops": {"wikibase_item": "Q123"}}}}
        })
    )
    respx.get(
        "https://www.wikidata.org/wiki/Special:EntityData/Q123.json"
    ).mock(return_value=Response(200, json={
        "entities": {"Q123": {"claims": {
            "P577": [{"rank": "normal", "mainsnak": {"datavalue": {"value": {"time": "+2020-01-01T00:00:00Z"}}}}],
        }}}
    }))
    enricher = WikidataEnricher(concurrency=2)
    out = await enricher.enrich([_ref()])  # default work_type="painting"
    assert out[0].inception_year is None
