from pathlib import Path
import re

from app.pipeline.palette import extract_palette_hex


_HEX_RE = re.compile(r"^#[0-9a-f]{6}$")
_FIXTURES = Path(__file__).parent.parent / "fixtures"


def test_extract_palette_returns_5_hex_strings():
    result = extract_palette_hex(_FIXTURES / "striped.jpg")
    assert len(result) == 5
    for hex_code in result:
        assert _HEX_RE.fullmatch(hex_code), f"Bad hex: {hex_code}"


def test_extract_palette_deterministic():
    result_a = extract_palette_hex(_FIXTURES / "striped.jpg")
    result_b = extract_palette_hex(_FIXTURES / "striped.jpg")
    assert result_a == result_b


def test_extract_palette_solid_color():
    result = extract_palette_hex(_FIXTURES / "red_solid.jpg")
    # All 5 clusters should be very close to pure red.
    for hex_code in result:
        r = int(hex_code[1:3], 16)
        g = int(hex_code[3:5], 16)
        b = int(hex_code[5:7], 16)
        assert r >= 240, f"Expected high red, got {hex_code}"
        assert g <= 15, f"Expected low green, got {hex_code}"
        assert b <= 15, f"Expected low blue, got {hex_code}"
