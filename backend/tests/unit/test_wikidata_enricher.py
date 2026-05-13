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
