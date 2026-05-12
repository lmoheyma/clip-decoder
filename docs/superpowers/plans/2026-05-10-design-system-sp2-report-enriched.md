# Design System Migration SP2 — Report Enriched Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin `/report/{id}` to the new editorial register **and** enrich it with the Tier-2 features (hex palette swatches, frame thumbnails per card, Wikipedia thumbnails, hidden references visible, summary card, multi-axes filter chips).

**Architecture:** Backend adds three new dependencies (Pillow, numpy, scikit-learn) to support KMeans palette extraction during frame analysis; adds two Pydantic fields, two pipeline integrations, one new endpoint, and extends one existing endpoint to surface `created_at`. Frontend deletes the binary `ConfidenceFilter` + `ReferencePanel`, adds `FilterBar` + `SummaryCard` + `reportStats` helper, rewrites `ReferenceCard` and the report page in the new editorial register.

**Tech Stack:** FastAPI, SQLAlchemy (with JSON column for report blob — no migration needed), Pydantic, Pillow + numpy + scikit-learn (new), Next.js 15 App Router, Tailwind v4 + plain CSS component classes, React 19, Vitest.

**Spec:** [docs/superpowers/specs/2026-05-10-design-system-migration-sp2-design.md](../specs/2026-05-10-design-system-migration-sp2-design.md)

---

## Notes for the implementer

**Visual reskin + real backend changes.** Unlike SP1 (pure frontend reskin), SP2 has backend additions: a new dependency family, a new endpoint, two new fields on existing Pydantic models, and one new pipeline integration.

**TDD where it applies:** backend tasks 3, 5, 6 follow TDD strictly (write failing test → implement → green). Frontend tasks for visual components don't have meaningful unit tests; their verification is the test suite remaining green + manual checklist at the end.

**Reference files** (untracked at repo root, kept as authoring source):
- `index.html` lines 905–1322 — report mockup
- `styles.css` — design system CSS (selectively copied into globals.css)

**Docker dev stack** is running:
- `clip-decoder-frontend-1` on port 3000 (Next.js dev)
- `clip-decoder-backend-1` on port 8000 (FastAPI with `--reload`)

**Commands to use** (pnpm is NOT installed locally):
- Frontend type-check: `docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit`
- Frontend tests: `docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run`
- Backend tests: `docker exec clip-decoder-backend-1 python -m pytest`
- Backend single test: `docker exec clip-decoder-backend-1 python -m pytest tests/unit/test_palette.py -v`

---

## Prerequisites

Before starting Task 1:

```bash
cd /home/louis/clip-decoder
git checkout main
git pull --ff-only
git checkout -b feature/design-system-sp2
```

Verify clean state and baseline:

```bash
git status                                                              # clean
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run   # 13/13 pass
docker exec clip-decoder-backend-1 python -m pytest                     # all green
```

If anything fails before changes, STOP and investigate.

---

### Task 1: Add Python image dependencies and rebuild Docker

**Files:**
- Modify: `backend/pyproject.toml`

**Why:** Pillow, numpy, scikit-learn are not in the dependency list. The palette extraction module (Task 3) needs all three. Adding them now avoids a rebuild mid-task later.

- [ ] **Step 1: Read current `backend/pyproject.toml` dependencies block**

Open `/home/louis/clip-decoder/backend/pyproject.toml`. Locate the `[project] dependencies = [...]` block. Note the indentation and trailing comma style.

- [ ] **Step 2: Add three new entries to the dependencies list**

Append these three lines inside `dependencies = [...]` (keep alphabetical ordering if it exists, else append at the end):

```toml
"Pillow>=10.0",
"numpy>=1.26",
"scikit-learn>=1.4",
```

- [ ] **Step 3: Rebuild the backend Docker image with the new dependencies**

Run from `/home/louis/clip-decoder`:
```bash
docker compose build backend
docker compose up -d backend
```

Expected: build succeeds (~30-60s for the dep install layer), backend container restarts and serves on port 8000.

- [ ] **Step 4: Verify the new packages are importable**

```bash
docker exec clip-decoder-backend-1 python -c "from PIL import Image; import numpy as np; from sklearn.cluster import KMeans; print('ok')"
```
Expected output: `ok`

- [ ] **Step 5: Verify existing backend tests still pass**

```bash
docker exec clip-decoder-backend-1 python -m pytest -q
```
Expected: all green, no regressions.

- [ ] **Step 6: Commit**

```bash
cd /home/louis/clip-decoder
git add backend/pyproject.toml
git commit -m "feat(backend): add Pillow, numpy, scikit-learn for palette extraction"
```

---

### Task 2: Extend Pydantic models with palette_hex and wikipedia_thumbnail_url

**Files:**
- Modify: `backend/app/models.py`

**Why:** Both fields have safe defaults so old persisted runs deserialize unchanged. Tasks 4 and 5 will populate them during pipeline execution.

- [ ] **Step 1: Add `palette_hex` field to `FrameAnalysis`**

In `/home/louis/clip-decoder/backend/app/models.py`, locate the `FrameAnalysis` class. Add a new field after `palette: list[str]`:

```python
class FrameAnalysis(BaseModel):
    timestamp_s: Annotated[float, Field(ge=0.0)]
    frame_id: str
    composition: str
    palette: list[str]
    palette_hex: list[str] = []  # NEW: 5 hex codes like ["#1c1c1c", "#3a4a6b", ...]
    camera_move: str
    costume_setting: str
    distinctive_features: list[str]
    raw_description: str
    confidence_in_observation: Annotated[float, Field(ge=0.0, le=1.0)]
```

- [ ] **Step 2: Add `wikipedia_thumbnail_url` field to `VerifiedReference`**

In the same file, locate the `VerifiedReference` class. Add a new field after `wikipedia_url`:

```python
class VerifiedReference(ReferenceCandidate):
    verdict: Verdict
    final_confidence: Confidence
    supporting_elements: list[str]
    wikipedia_url: str | None = None
    wikipedia_thumbnail_url: str | None = None  # NEW
```

- [ ] **Step 3: Run existing tests to confirm no regression**

```bash
docker exec clip-decoder-backend-1 python -m pytest -q
```
Expected: all green. The new fields have defaults so existing code paths work unchanged.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py
git commit -m "feat(backend): add palette_hex and wikipedia_thumbnail_url fields"
```

---

### Task 3: Create palette extraction module with tests

**Files:**
- Create: `backend/app/pipeline/palette.py`
- Create: `backend/tests/unit/test_palette.py`
- Create: `backend/tests/fixtures/red_solid.jpg` (small fixture)
- Create: `backend/tests/fixtures/striped.jpg` (small fixture)

**Why:** Isolated module for KMeans palette extraction. Tested independently from the pipeline. Used by Task 4.

- [ ] **Step 1: Create fixture images for tests**

We need two small JPG fixtures. Generate them programmatically in a setup script so they're reproducible:

```bash
docker exec clip-decoder-backend-1 python -c "
from PIL import Image
import os
os.makedirs('tests/fixtures', exist_ok=True)
Image.new('RGB', (50, 50), '#ff0000').save('tests/fixtures/red_solid.jpg')
img = Image.new('RGB', (50, 50))
pixels = img.load()
colors = [(255,0,0), (0,255,0), (0,0,255), (255,255,0), (255,0,255)]
for y in range(50):
    for x in range(50):
        pixels[x, y] = colors[(x*5 // 50) % 5]
img.save('tests/fixtures/striped.jpg')
print('fixtures created')
"
```

Verify the fixtures exist on disk:
```bash
docker exec clip-decoder-backend-1 ls -la tests/fixtures/
```
Expected: `red_solid.jpg` and `striped.jpg` both ~1-2KB.

- [ ] **Step 2: Write the failing tests**

Create `/home/louis/clip-decoder/backend/tests/unit/test_palette.py`:

```python
from pathlib import Path
import re
import pytest
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
    # All 5 clusters should be very close to pure red. Tolerance: each hex
    # decodes to RGB where R>=240 and G,B<=15.
    for hex_code in result:
        r = int(hex_code[1:3], 16)
        g = int(hex_code[3:5], 16)
        b = int(hex_code[5:7], 16)
        assert r >= 240, f"Expected high red, got {hex_code}"
        assert g <= 15, f"Expected low green, got {hex_code}"
        assert b <= 15, f"Expected low blue, got {hex_code}"
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
docker exec clip-decoder-backend-1 python -m pytest tests/unit/test_palette.py -v
```
Expected: all 3 tests fail with `ModuleNotFoundError: No module named 'app.pipeline.palette'`.

- [ ] **Step 4: Implement the palette module**

Create `/home/louis/clip-decoder/backend/app/pipeline/palette.py`:

```python
from pathlib import Path

import numpy as np
from PIL import Image
from sklearn.cluster import KMeans

_N_CLUSTERS = 5
_SAMPLE_SIZE = 100  # downscale before clustering — fast + stable


def extract_palette_hex(frame_path: Path) -> list[str]:
    """Return 5 dominant colors of a frame as hex strings, ordered by cluster size desc."""
    img = Image.open(frame_path).convert("RGB")
    img.thumbnail((_SAMPLE_SIZE, _SAMPLE_SIZE))
    pixels = np.array(img).reshape(-1, 3)
    km = KMeans(n_clusters=_N_CLUSTERS, n_init=4, random_state=42).fit(pixels)
    centers = km.cluster_centers_.astype(int)
    counts = np.bincount(km.labels_, minlength=_N_CLUSTERS)
    order = np.argsort(-counts)  # largest cluster first
    return [_rgb_to_hex(centers[i]) for i in order]


def _rgb_to_hex(rgb) -> str:
    return "#" + "".join(f"{c:02x}" for c in rgb)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
docker exec clip-decoder-backend-1 python -m pytest tests/unit/test_palette.py -v
```
Expected: all 3 tests pass.

- [ ] **Step 6: Run the full backend test suite to verify no regression**

```bash
docker exec clip-decoder-backend-1 python -m pytest -q
```
Expected: all green.

- [ ] **Step 7: Commit (include fixtures)**

```bash
git add backend/app/pipeline/palette.py backend/tests/unit/test_palette.py backend/tests/fixtures/red_solid.jpg backend/tests/fixtures/striped.jpg
git commit -m "feat(backend): add palette extraction module (PIL+KMeans, 5 hex codes)"
```

---

### Task 4: Integrate palette extraction in frame_analyzer

**Files:**
- Modify: `backend/app/pipeline/frame_analyzer.py`

**Why:** `FrameAnalysis` is built in `frame_analyzer._one()`. Hook palette extraction there so every analyzed frame gets its hex palette automatically. The keyframe jpg is already on disk at this point (shot_sampler wrote it).

- [ ] **Step 1: Read current frame_analyzer.py to locate `_one`**

Open `/home/louis/clip-decoder/backend/app/pipeline/frame_analyzer.py`. The `_one(self, kf: KeyFrame)` method (around line 27) returns `FrameAnalysis(...)` (around line 35-44). The `kf.frame_path` is the path to the keyframe jpg on disk.

- [ ] **Step 2: Add the palette import at the top of the file**

Add this import alongside the existing imports:

```python
from app.pipeline.palette import extract_palette_hex
```

- [ ] **Step 3: Call `extract_palette_hex` inside `_one` and include it in the returned `FrameAnalysis`**

Change the `_one` return statement from:

```python
return FrameAnalysis(
    timestamp_s=kf.timestamp_s,
    frame_id=kf.shot_id,
    composition=data.get("composition", ""),
    palette=[str(x) for x in (data.get("palette") or [])],
    camera_move=data.get("camera_move", ""),
    costume_setting=data.get("costume_setting", ""),
    distinctive_features=[str(x) for x in (data.get("distinctive_features") or [])],
    raw_description=data.get("raw_description", ""),
    confidence_in_observation=_clamp(data.get("confidence_in_observation", 0.5)),
)
```

To:

```python
palette_hex = extract_palette_hex(kf.frame_path)
return FrameAnalysis(
    timestamp_s=kf.timestamp_s,
    frame_id=kf.shot_id,
    composition=data.get("composition", ""),
    palette=[str(x) for x in (data.get("palette") or [])],
    palette_hex=palette_hex,
    camera_move=data.get("camera_move", ""),
    costume_setting=data.get("costume_setting", ""),
    distinctive_features=[str(x) for x in (data.get("distinctive_features") or [])],
    raw_description=data.get("raw_description", ""),
    confidence_in_observation=_clamp(data.get("confidence_in_observation", 0.5)),
)
```

(Verify the exact existing field list by reading the file first — if any field names differ from above, preserve them.)

- [ ] **Step 4: Run backend tests to verify no regression**

```bash
docker exec clip-decoder-backend-1 python -m pytest -q
```
Expected: all green. Some tests may mock `extract_palette_hex` or stub frame_path — verify by reading any failing message.

- [ ] **Step 5: Commit**

```bash
git add backend/app/pipeline/frame_analyzer.py
git commit -m "feat(backend): extract palette_hex in frame_analyzer._one"
```

---

### Task 5: Parse Wikipedia thumbnail URL in verifier

**Files:**
- Modify: `backend/app/pipeline/verifier.py`
- Modify: `backend/tests/unit/test_verifier.py`

**Why:** The verifier already calls `GET /page/summary/{title}` for each candidate. The response JSON includes `thumbnail.source` when the article has a thumbnail. Parse it and store on `VerifiedReference.wikipedia_thumbnail_url`.

- [ ] **Step 1: Locate the Wikipedia summary parsing code**

Open `/home/louis/clip-decoder/backend/app/pipeline/verifier.py`. Search for where the verifier handles the Wikipedia `/page/summary/` response. There should be a code path that extracts the page URL from the JSON. The thumbnail is at `data["thumbnail"]["source"]` (may be absent).

- [ ] **Step 2: Write the failing tests first (TDD)**

In `/home/louis/clip-decoder/backend/tests/unit/test_verifier.py`, add two new tests at the bottom of the file:

```python
async def test_wikipedia_thumb_parsed_when_present(monkeypatch):
    """When Wikipedia response contains thumbnail.source, the URL is stored on the VerifiedReference."""
    # The exact mocking pattern depends on how verifier.py is structured.
    # Look at existing tests in this file for the established pattern.
    # The test should:
    # 1. Construct a ReferenceCandidate input
    # 2. Mock the httpx client to return a Wikipedia response with thumbnail.source
    # 3. Call the verifier's relevant entry point
    # 4. Assert result.wikipedia_thumbnail_url == "https://upload.wikimedia.org/..."
    pass  # IMPLEMENT BASED ON EXISTING PATTERN


async def test_wikipedia_thumb_none_when_absent(monkeypatch):
    """When Wikipedia response has no thumbnail, the URL stays None."""
    # Same setup as above but response has no `thumbnail` key.
    # Assert result.wikipedia_thumbnail_url is None
    pass  # IMPLEMENT BASED ON EXISTING PATTERN
```

Read `/home/louis/clip-decoder/backend/tests/unit/test_verifier.py` to find the existing mocking pattern (look for `respx`, `httpx_mock`, or `monkeypatch` usage), then fill in the two test bodies above following that exact pattern. The mock response shape should be the real Wikipedia summary JSON shape:

```json
{
  "title": "...",
  "content_urls": { "desktop": { "page": "https://en.wikipedia.org/wiki/..." } },
  "thumbnail": { "source": "https://upload.wikimedia.org/wikipedia/commons/thumb/.../200px-...jpg", "width": 200, "height": 200 }
}
```

For the "absent" case, omit the `thumbnail` key entirely.

- [ ] **Step 3: Run the new tests to verify they fail**

```bash
docker exec clip-decoder-backend-1 python -m pytest tests/unit/test_verifier.py -v -k "thumb"
```
Expected: both new tests fail (assertion or attribute error — `wikipedia_thumbnail_url` is `None` because verifier doesn't set it yet).

- [ ] **Step 4: Implement the thumbnail parsing in verifier.py**

In `verifier.py`, locate the response parsing for the Wikipedia summary call. Add the thumbnail extraction:

```python
# After parsing the response JSON (variable likely named `data` or `summary`):
thumb_url = data.get("thumbnail", {}).get("source")
# Then when building the VerifiedReference, pass:
# wikipedia_thumbnail_url=thumb_url
```

Exact placement depends on the existing code flow. The minimal change: where the `VerifiedReference` is constructed, add `wikipedia_thumbnail_url=thumb_url` to the kwargs.

- [ ] **Step 5: Run the new tests to verify they pass**

```bash
docker exec clip-decoder-backend-1 python -m pytest tests/unit/test_verifier.py -v -k "thumb"
```
Expected: both new tests pass.

- [ ] **Step 6: Run full verifier tests + backend suite for no regression**

```bash
docker exec clip-decoder-backend-1 python -m pytest tests/unit/test_verifier.py -v
docker exec clip-decoder-backend-1 python -m pytest -q
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/pipeline/verifier.py backend/tests/unit/test_verifier.py
git commit -m "feat(backend): parse Wikipedia thumbnail.source into VerifiedReference"
```

---

### Task 6: Add frame serving endpoint with regex validation

**Files:**
- Modify: `backend/app/api/routes.py`
- Create: `backend/tests/integration/test_frames_endpoint.py`

**Why:** Frontend `<img>` tags need to load keyframes from the backend. Endpoint streams the JPEG file with strong cache headers. Path traversal blocked by regex validation on both path params.

- [ ] **Step 1: Write the failing tests first**

Create `/home/louis/clip-decoder/backend/tests/integration/test_frames_endpoint.py`:

```python
import shutil
from pathlib import Path

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.settings import settings


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def frame_on_disk(tmp_path, monkeypatch):
    """Create a fake keyframe at the expected location under a tmp data_dir."""
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    yt = "dQw4w9WgXcQ"
    frame_dir = tmp_path / "runs" / yt / "frames"
    frame_dir.mkdir(parents=True)
    # Use a fixture jpg from tests/fixtures (created in Task 3)
    src = Path(__file__).parent.parent / "fixtures" / "red_solid.jpg"
    shutil.copy(src, frame_dir / "shot_001.jpg")
    yield yt


async def test_get_frame_returns_200_with_correct_mime(client, frame_on_disk):
    r = await client.get(f"/api/frames/{frame_on_disk}/shot_001")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert "max-age=31536000" in r.headers.get("cache-control", "")


async def test_get_frame_404_on_missing(client, frame_on_disk):
    r = await client.get(f"/api/frames/{frame_on_disk}/shot_999")
    assert r.status_code == 404


async def test_get_frame_400_on_invalid_frame_id(client, frame_on_disk):
    r = await client.get(f"/api/frames/{frame_on_disk}/bogus_id")
    assert r.status_code == 400


async def test_get_frame_400_on_invalid_youtube_id(client, frame_on_disk):
    r = await client.get("/api/frames/short/shot_001")
    assert r.status_code == 400
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
docker exec clip-decoder-backend-1 python -m pytest tests/integration/test_frames_endpoint.py -v
```
Expected: all 4 tests fail with 404 (route not defined yet).

- [ ] **Step 3: Implement the endpoint in routes.py**

Open `/home/louis/clip-decoder/backend/app/api/routes.py`. At the top with the other imports, add:

```python
import re
from fastapi.responses import FileResponse
from app.settings import settings
```

(Adjust if `settings` is already imported.)

At the module level (near other regex constants if any), add:

```python
_YOUTUBE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")
_FRAME_ID_RE = re.compile(r"^shot_\d+$")
```

Inside the function that builds the router (around line 38 where `router = APIRouter(prefix="/api")` lives), add a new route handler alongside the others. Place it between `/report/{youtube_id}/flag` and `/stream/{youtube_id}`:

```python
@router.get("/frames/{youtube_id}/{frame_id}")
def get_frame(youtube_id: str, frame_id: str):
    if not _YOUTUBE_ID_RE.fullmatch(youtube_id):
        raise HTTPException(status_code=400, detail="invalid youtube_id format")
    if not _FRAME_ID_RE.fullmatch(frame_id):
        raise HTTPException(status_code=400, detail="invalid frame_id format")
    path = settings.data_dir / "runs" / youtube_id / "frames" / f"{frame_id}.jpg"
    if not path.exists():
        raise HTTPException(status_code=404, detail="frame not found")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
```

(Note: decorator uses `/frames/...` NOT `/api/frames/...` because the router already has `prefix="/api"`.)

- [ ] **Step 4: Run the new tests to verify they pass**

```bash
docker exec clip-decoder-backend-1 python -m pytest tests/integration/test_frames_endpoint.py -v
```
Expected: all 4 tests pass.

- [ ] **Step 5: Smoke check the endpoint via curl**

The dev backend container auto-reloads on file change. Verify externally:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8000/api/frames/bogus_short/shot_001"
```
Expected: `400` (invalid youtube_id format).

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8000/api/frames/12345678901/shot_999"
```
Expected: `404` (valid format, frame not on disk).

- [ ] **Step 6: Run full backend test suite**

```bash
docker exec clip-decoder-backend-1 python -m pytest -q
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/routes.py backend/tests/integration/test_frames_endpoint.py
git commit -m "feat(backend): add /api/frames/{youtube_id}/{frame_id} endpoint with regex validation"
```

---

### Task 7: Extend /api/report response with created_at

**Files:**
- Modify: `backend/app/db.py`
- Modify: `backend/app/api/routes.py`

**Why:** `AnalysisRow.created_at` already exists in DB. Frontend report header shows "Analysed {date}". Easiest path: a new `db.load_report_meta(youtube_id) -> tuple[Report, datetime] | None` method that returns both, then the route merges them into the response.

- [ ] **Step 1: Add `load_report_meta` method to Database class**

Open `/home/louis/clip-decoder/backend/app/db.py`. Locate the `load_report(self, youtube_id)` method (around line 112). Right after it, add:

```python
    async def load_report_meta(
        self, youtube_id: str
    ) -> tuple[Report, datetime] | None:
        """Like load_report but also returns the row's created_at timestamp."""
        async with self._session() as s:
            row = await s.get(AnalysisRow, youtube_id)
            if row is None or row.report_json is None:
                return None
            return Report.model_validate(row.report_json), row.created_at
```

If `datetime` is not already imported at the top of `db.py`, add `from datetime import datetime` to the imports.

- [ ] **Step 2: Update the `/api/report/{youtube_id}` route to use the new method**

In `/home/louis/clip-decoder/backend/app/api/routes.py`, find the existing `get_report` handler (around line 62-67):

```python
@router.get("/report/{youtube_id}")
async def get_report(youtube_id: str) -> dict:
    report = await db.load_report(youtube_id)
    if report is None:
        raise HTTPException(status_code=404, detail="report not found")
    return report.model_dump(mode="json")
```

Replace it with:

```python
@router.get("/report/{youtube_id}")
async def get_report(youtube_id: str) -> dict:
    result = await db.load_report_meta(youtube_id)
    if result is None:
        raise HTTPException(status_code=404, detail="report not found")
    report, created_at = result
    return {
        **report.model_dump(mode="json"),
        "created_at": created_at.isoformat(),
    }
```

- [ ] **Step 3: Update or add a test verifying created_at is in the response**

Open `/home/louis/clip-decoder/backend/tests/integration/` and look for an existing test that hits `/api/report/{id}` (if any). If there's a test that asserts the response shape, extend it to assert `"created_at"` key is present and is a valid ISO 8601 string.

If no such test exists, write a small one in a new or existing integration test file:

```python
async def test_get_report_includes_created_at(client, db, sample_report):
    await db.save_report(sample_report)
    r = await client.get(f"/api/report/{sample_report.youtube_id}")
    assert r.status_code == 200
    body = r.json()
    assert "created_at" in body
    # ISO 8601 format check
    from datetime import datetime
    datetime.fromisoformat(body["created_at"])
```

(Adapt fixture names to match existing test setup. Look at `backend/tests/unit/test_db.py:40` for the `sample_report` fixture pattern.)

- [ ] **Step 4: Run tests**

```bash
docker exec clip-decoder-backend-1 python -m pytest -q
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add backend/app/db.py backend/app/api/routes.py backend/tests/integration/
git commit -m "feat(backend): include created_at in /api/report response via load_report_meta"
```

---

### Task 8: Frontend types update + reportStats helper with tests

**Files:**
- Modify: `frontend/lib/types.ts`
- Create: `frontend/lib/reportStats.ts`
- Create: `frontend/lib/reportStats.test.ts`

**Why:** Frontend needs to read new backend fields. The stats computation (counts, year span, type breakdown) is pure derivation worth extracting into a testable helper.

- [ ] **Step 1: Read current types.ts to understand its shape**

Open `/home/louis/clip-decoder/frontend/lib/types.ts`. Note the existing types (`Report`, `VerifiedReference`, `FrameAnalysis`, `PipelineEvent`, etc.).

- [ ] **Step 2: Add new fields**

In `/home/louis/clip-decoder/frontend/lib/types.ts`:

```typescript
// Inside FrameAnalysis:
palette_hex?: string[];  // NEW — 5 hex codes, may be empty for old runs

// Inside VerifiedReference:
wikipedia_thumbnail_url?: string | null;  // NEW

// Inside Report:
created_at?: string;  // NEW — ISO 8601 datetime, injected by /api/report endpoint
```

Use `?:` (optional) so old payloads without these fields still validate at the type level.

- [ ] **Step 3: Write failing tests for reportStats**

Create `/home/louis/clip-decoder/frontend/lib/reportStats.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeReportStats } from "./reportStats";
import type { Report, VerifiedReference } from "./types";

function makeRef(overrides: Partial<VerifiedReference>): VerifiedReference {
  return {
    timestamp_s: 0,
    source_frame_id: "shot_001",
    work_title: "Untitled",
    work_creator: "Anon",
    work_year: 2000,
    work_type: "Painting",
    reasoning: "",
    raw_confidence: 0.5,
    verdict: "keep",
    final_confidence: "confirmed",
    supporting_elements: [],
    wikipedia_url: null,
    ...overrides,
  };
}

function makeReport(refs: VerifiedReference[]): Report {
  return {
    youtube_id: "x",
    title: "",
    channel: "",
    duration_s: 100,
    references: refs,
    frame_analyses: [],
  };
}

describe("computeReportStats", () => {
  it("returns zero counts for empty references", () => {
    const stats = computeReportStats(makeReport([]));
    expect(stats.confirmed).toBe(0);
    expect(stats.speculative).toBe(0);
    expect(stats.hidden).toBe(0);
    expect(stats.total).toBe(0);
    expect(stats.minYear).toBeNull();
    expect(stats.maxYear).toBeNull();
    expect(stats.typeBreakdown).toEqual([]);
  });

  it("counts each verdict correctly", () => {
    const stats = computeReportStats(
      makeReport([
        makeRef({ final_confidence: "confirmed" }),
        makeRef({ final_confidence: "confirmed" }),
        makeRef({ final_confidence: "speculative" }),
        makeRef({ final_confidence: "hidden" }),
      ]),
    );
    expect(stats.confirmed).toBe(2);
    expect(stats.speculative).toBe(1);
    expect(stats.hidden).toBe(1);
    expect(stats.total).toBe(4);
  });

  it("returns min/max year ignoring null years", () => {
    const stats = computeReportStats(
      makeReport([
        makeRef({ work_year: 1929 }),
        makeRef({ work_year: null }),
        makeRef({ work_year: 2014 }),
        makeRef({ work_year: 1979 }),
      ]),
    );
    expect(stats.minYear).toBe(1929);
    expect(stats.maxYear).toBe(2014);
  });

  it("groups type breakdown sorted by count desc", () => {
    const stats = computeReportStats(
      makeReport([
        makeRef({ work_type: "Film" }),
        makeRef({ work_type: "Film" }),
        makeRef({ work_type: "Painting" }),
        makeRef({ work_type: "Film" }),
        makeRef({ work_type: "Photograph" }),
      ]),
    );
    expect(stats.typeBreakdown).toEqual([
      { type: "Film", count: 3 },
      { type: "Painting", count: 1 },
      { type: "Photograph", count: 1 },
    ]);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run lib/reportStats
```
Expected: fail with "module not found".

- [ ] **Step 5: Implement reportStats**

Create `/home/louis/clip-decoder/frontend/lib/reportStats.ts`:

```typescript
import type { Report, VerifiedReference } from "./types";

export interface ReportStats {
  total: number;
  confirmed: number;
  speculative: number;
  hidden: number;
  shots: number;
  wikiHits: number;
  minYear: number | null;
  maxYear: number | null;
  typeBreakdown: { type: string; count: number }[];
  availableTypes: string[];
}

export function computeReportStats(report: Report): ReportStats {
  const refs = report.references;
  let confirmed = 0;
  let speculative = 0;
  let hidden = 0;
  let wikiHits = 0;
  const years: number[] = [];
  const typeCounts = new Map<string, number>();

  for (const r of refs) {
    if (r.final_confidence === "confirmed") confirmed++;
    else if (r.final_confidence === "speculative") speculative++;
    else if (r.final_confidence === "hidden") hidden++;
    if (r.wikipedia_url) wikiHits++;
    if (typeof r.work_year === "number") years.push(r.work_year);
    typeCounts.set(r.work_type, (typeCounts.get(r.work_type) ?? 0) + 1);
  }

  const typeBreakdown = Array.from(typeCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  return {
    total: refs.length,
    confirmed,
    speculative,
    hidden,
    shots: report.frame_analyses.length,
    wikiHits,
    minYear: years.length ? Math.min(...years) : null,
    maxYear: years.length ? Math.max(...years) : null,
    typeBreakdown,
    availableTypes: typeBreakdown.map((t) => t.type),
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run lib/reportStats
```
Expected: all 4 tests pass.

- [ ] **Step 7: Run full frontend suite**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
```
Expected: green + zero TS errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/reportStats.ts frontend/lib/reportStats.test.ts
git commit -m "feat(frontend): types for new backend fields + computeReportStats helper"
```

---

### Task 9: FilterBar component with tests

**Files:**
- Create: `frontend/components/FilterBar.tsx`
- Create: `frontend/components/FilterBar.test.tsx`

**Why:** Replaces the binary `ConfidenceFilter`. Multi-axes toggle chips: 3 verdict + N work_type. AND between groups, OR within.

- [ ] **Step 1: Write failing tests**

Create `/home/louis/clip-decoder/frontend/components/FilterBar.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FilterBar } from "./FilterBar";
import type { Confidence } from "@/lib/types";

const verdictCounts = { confirmed: 12, speculative: 5, hidden: 2 };
const typeCounts = { Film: 8, Painting: 4 };

describe("FilterBar", () => {
  it("toggle verdict chip calls onToggleVerdict", () => {
    const onToggleVerdict = vi.fn();
    const onToggleType = vi.fn();
    render(
      <FilterBar
        verdictCounts={verdictCounts}
        typeCounts={typeCounts}
        availableTypes={["Film", "Painting"]}
        selectedVerdicts={new Set<Confidence>(["confirmed", "speculative"])}
        selectedTypes={new Set(["Film", "Painting"])}
        onToggleVerdict={onToggleVerdict}
        onToggleType={onToggleType}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /hidden/i }));
    expect(onToggleVerdict).toHaveBeenCalledWith("hidden");
    expect(onToggleType).not.toHaveBeenCalled();
  });

  it("default selection marks hidden chip as chip-off", () => {
    render(
      <FilterBar
        verdictCounts={verdictCounts}
        typeCounts={typeCounts}
        availableTypes={["Film"]}
        selectedVerdicts={new Set<Confidence>(["confirmed", "speculative"])}
        selectedTypes={new Set(["Film"])}
        onToggleVerdict={() => {}}
        onToggleType={() => {}}
      />,
    );
    const hiddenChip = screen.getByRole("button", { name: /hidden/i });
    expect(hiddenChip.className).toContain("chip-off");
    const confirmedChip = screen.getByRole("button", { name: /confirmed/i });
    expect(confirmedChip.className).toContain("chip-on");
  });

  it("toggle work_type chip is independent from verdict chips", () => {
    const onToggleVerdict = vi.fn();
    const onToggleType = vi.fn();
    render(
      <FilterBar
        verdictCounts={verdictCounts}
        typeCounts={typeCounts}
        availableTypes={["Film", "Painting"]}
        selectedVerdicts={new Set<Confidence>(["confirmed", "speculative"])}
        selectedTypes={new Set(["Film", "Painting"])}
        onToggleVerdict={onToggleVerdict}
        onToggleType={onToggleType}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^painting$/i }));
    expect(onToggleType).toHaveBeenCalledWith("Painting");
    expect(onToggleVerdict).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run components/FilterBar
```
Expected: fail with "module not found".

- [ ] **Step 3: Implement FilterBar**

Create `/home/louis/clip-decoder/frontend/components/FilterBar.tsx`:

```typescript
"use client";
import type { Confidence } from "@/lib/types";

const VERDICTS: { key: Confidence; label: string; chipClass: string }[] = [
  { key: "confirmed", label: "Confirmed", chipClass: "chip-amber" },
  { key: "speculative", label: "Speculative", chipClass: "chip-cyan" },
  { key: "hidden", label: "Hidden", chipClass: "chip-dim" },
];

export interface FilterBarProps {
  verdictCounts: Record<Confidence, number>;
  typeCounts: Record<string, number>;
  availableTypes: string[];
  selectedVerdicts: Set<Confidence>;
  selectedTypes: Set<string>;
  onToggleVerdict: (v: Confidence) => void;
  onToggleType: (t: string) => void;
}

export function FilterBar({
  verdictCounts,
  typeCounts,
  availableTypes,
  selectedVerdicts,
  selectedTypes,
  onToggleVerdict,
  onToggleType,
}: FilterBarProps) {
  return (
    <div className="filter-bar">
      <div className="left">
        {VERDICTS.map((v) => {
          const on = selectedVerdicts.has(v.key);
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => onToggleVerdict(v.key)}
              className={`chip ${v.chipClass} ${on ? "chip-on" : "chip-off"}`}
            >
              <span className="num">{verdictCounts[v.key] ?? 0}</span> {v.label}
            </button>
          );
        })}
        <span className="filter-divider" />
        {availableTypes.map((t) => {
          const on = selectedTypes.has(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => onToggleType(t)}
              className={`chip ${on ? "chip-on" : "chip-off"}`}
            >
              <span className="num">{typeCounts[t] ?? 0}</span> {t}
            </button>
          );
        })}
      </div>
      <div className="right">
        <span className="hairline">Sort · timecode ↑</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run components/FilterBar
```
Expected: all 3 tests pass.

- [ ] **Step 5: Run full frontend suite**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/FilterBar.tsx frontend/components/FilterBar.test.tsx
git commit -m "feat(frontend): add FilterBar component with verdict + work_type chips"
```

---

### Task 10: SummaryCard component

**Files:**
- Create: `frontend/components/SummaryCard.tsx`

**Why:** Right column of the player-row. Pure display of stats already computed by `computeReportStats`. No tests (consumes typed input, all derivations are tested in reportStats).

- [ ] **Step 1: Create SummaryCard**

Create `/home/louis/clip-decoder/frontend/components/SummaryCard.tsx`:

```typescript
"use client";
import type { ReportStats } from "@/lib/reportStats";

export function SummaryCard({ stats }: { stats: ReportStats }) {
  const showSources = stats.minYear !== null && stats.maxYear !== null;
  const typeText = stats.typeBreakdown
    .map((t) => `${t.count} ${t.type.toLowerCase()}${t.count > 1 ? "s" : ""}`)
    .join(" · ");

  return (
    <aside className="summary-card">
      <div>
        <div className="hairline">References found</div>
        <div className="summary-num">
          <em className="serif-it">{stats.total}</em>
          <small>across {stats.shots} shots</small>
        </div>
      </div>
      <div className="breakdown">
        <div>
          <span>
            <span className="swatch" style={{ background: "var(--grad-peach)" }} />
            Confirmed
          </span>
          <span className="v">{stats.confirmed}</span>
        </div>
        <div>
          <span>
            <span className="swatch" style={{ background: "var(--grad-sky)" }} />
            Speculative
          </span>
          <span className="v">{stats.speculative}</span>
        </div>
        <div>
          <span>
            <span className="swatch" style={{ background: "var(--error)" }} />
            Hidden
          </span>
          <span className="v">{stats.hidden}</span>
        </div>
      </div>
      {showSources && (
        <div className="hairline summary-sources">
          Sources span {stats.minYear} → {stats.maxYear} · {typeText}
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/SummaryCard.tsx
git commit -m "feat(frontend): add SummaryCard with breakdown + sources span"
```

---

### Task 11: ReferenceCard rewrite

**Files:**
- Modify: `frontend/components/ReferenceCard.tsx` (full rewrite)

**Why:** New card markup with frame thumb, palette swatches, verdict marker, italic title + Wikipedia mini-thumb, reasoning, evidence chips, confidence bar, action links. Supports `hidden` variant with line-through title + grayscale thumb.

- [ ] **Step 1: Replace ReferenceCard.tsx**

Replace `/home/louis/clip-decoder/frontend/components/ReferenceCard.tsx` entirely with:

```typescript
"use client";
import type { VerifiedReference } from "@/lib/types";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

const VERDICT_META: Record<
  string,
  { label: string; icon: string; chipExtra: string; confExtra: string; barColor: string }
> = {
  confirmed: { label: "CONFIRMED", icon: "●", chipExtra: "", confExtra: "", barColor: "" },
  speculative: { label: "SPECULATIVE", icon: "◌", chipExtra: "chip-cyan", confExtra: "conf-cyan", barColor: "" },
  hidden: { label: "HIDDEN", icon: "✕", chipExtra: "chip-dim", confExtra: "conf-rose", barColor: "" },
};

export function ReferenceCard({
  reference,
  paletteHex,
  paletteDescriptors,
  youtubeId,
  onJump,
  onFlag,
}: {
  reference: VerifiedReference;
  paletteHex: string[];
  paletteDescriptors: string[];
  youtubeId: string;
  onJump: () => void;
  onFlag: () => void;
}) {
  const verdict = reference.final_confidence;
  const meta = VERDICT_META[verdict];
  const tc = formatTimecode(reference.timestamp_s);
  const isHidden = verdict === "hidden";
  const confPercent = Math.round(reference.raw_confidence * 100);

  function handleKey(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onJump();
    }
  }

  return (
    <article
      className={`ref ref-${verdict}`}
      role="button"
      tabIndex={0}
      onClick={onJump}
      onKeyDown={handleKey}
      aria-label={`Reference: ${reference.work_title} at ${tc}`}
    >
      <div className="ref-left">
        <div
          className="thumb"
          style={{
            backgroundImage: `url(/api/frames/${youtubeId}/${reference.source_frame_id})`,
            filter: isHidden ? "grayscale(0.7) brightness(0.6)" : undefined,
          }}
        >
          <span className="tc-overlay">
            {tc} · {reference.source_frame_id.toUpperCase()}
          </span>
        </div>
        {paletteHex.length > 0 && (
          <>
            <div className="palette" style={{ marginTop: 8, opacity: isHidden ? 0.4 : 1 }}>
              {paletteHex.map((hex, i) => (
                <span key={i} style={{ background: hex }} />
              ))}
            </div>
            {paletteDescriptors.length > 0 && (
              <div className="hairline palette-label">
                PALETTE · {paletteDescriptors.join(" → ").toUpperCase()}
              </div>
            )}
          </>
        )}
      </div>

      <div className="ref-right">
        <div className="ref-verdict-line">
          <span className={`verdict-marker verdict-${verdict}`}>
            {meta.icon} {meta.label}
          </span>
          <span>·</span>
          <span>{reference.work_type}</span>
          {reference.wikipedia_url && (
            <>
              <span>·</span>
              <span>Wikipedia verified</span>
            </>
          )}
        </div>

        <div className="ref-title-row">
          <h3 className={`serif-it ref-title ${isHidden ? "ref-title-rejected" : ""}`}>
            <em>{reference.work_title}</em>
          </h3>
          {reference.wikipedia_thumbnail_url && (
            <img
              src={reference.wikipedia_thumbnail_url}
              alt=""
              className="wiki-thumb"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
        </div>

        <div className="ref-meta">
          {reference.work_creator} · {reference.work_year ?? "—"} · {reference.work_type}
        </div>

        <p className="ref-reasoning">{reference.reasoning}</p>

        {reference.supporting_elements.length > 0 && (
          <div className="ev">
            {reference.supporting_elements.map((el, i) => (
              <span key={i} className={`chip ${meta.chipExtra}`}>
                {el}
              </span>
            ))}
          </div>
        )}

        <div className={`conf ${meta.confExtra}`}>
          <span>CONFIDENCE</span>
          <span className="bar">
            <i style={{ width: `${confPercent}%` }} />
          </span>
          <span>{reference.raw_confidence.toFixed(2)}</span>
        </div>

        <div className="ref-actions">
          <a
            className="ulink"
            onClick={(e) => {
              e.stopPropagation();
              onJump();
            }}
          >
            ▸ JUMP TO {tc}
          </a>
          {reference.wikipedia_url && (
            <a
              className="ulink"
              href={reference.wikipedia_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              WIKIPEDIA ↗
            </a>
          )}
          {!isHidden && (
            <a
              className="ulink ulink-muted"
              onClick={(e) => {
                e.stopPropagation();
                onFlag();
              }}
            >
              NOT CONVINCED ✕
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
```
Expected: zero errors. If errors mention missing `paletteHex` or other props in callers (Task 13 hasn't run yet), that's OK — note them and move on. The current `app/report/[id]/page.tsx` will still need updates in Task 13.

- [ ] **Step 3: Run frontend tests**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: existing tests still pass. If `app/report/[id]/page.tsx` doesn't compile because it still passes old props to ReferenceCard, that's OK — Task 13 will fix it. The tests that exist (HeroForm, FilterBar, reportStats, etc.) should still pass.

If a build error blocks tests, you can temporarily revert callers OR proceed to Task 13 directly and commit them together. Recommended: commit this task and continue.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/ReferenceCard.tsx
git commit -m "feat(frontend): rewrite ReferenceCard with thumb + palette + verdict markers"
```

---

### Task 12: Add report-specific CSS classes to globals.css

**Files:**
- Modify: `frontend/app/globals.css`

**Why:** All the new component classes (`.ref`, `.thumb`, `.tc-overlay`, `.palette`, `.player-row`, `.summary-card`, `.filter-bar`, `.grid`, `.ev`, `.conf`, `.bar`, `.ulink`, `.report-header`, `.report-footer`, `.wiki-thumb`, etc.) need their CSS rules so the rewritten components actually render.

- [ ] **Step 1: Locate the insertion point**

Open `/home/louis/clip-decoder/frontend/app/globals.css`. Find the SP1 block (search for `SP1 — Component primitives`). The new report classes should be appended at the end of the SP1 block, BEFORE the legacy `.bg-pastel-cloud` block. Place a new comment header to mark the SP2 boundary.

- [ ] **Step 2: Append the SP2 report classes**

Insert this block in `/home/louis/clip-decoder/frontend/app/globals.css` immediately after the last SP1 rule (the slate mobile media query from SP1 Task 6), and before the legacy section:

```css
/* ─────────────────────────────────────────────────────────────────
   SP2 — Report-specific components.
   Player row, summary card, filter bar, reference grid + cards,
   action links, report header/footer.
   ───────────────────────────────────────────────────────────────── */

/* ─── Report header ──────────────────────────── */
.report-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: clamp(32px, 5vw, 64px);
}
.report-h1 {
  font-size: clamp(56px, 7vw, 96px);
  line-height: 0.96;
  margin: 0;
  color: var(--ink);
}
.report-title {
  font-size: clamp(28px, 3vw, 40px);
  margin: 20px 0 0 0;
  color: var(--body-strong);
}
.report-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  font-family: var(--sans);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--muted);
}

/* ─── Player row ─────────────────────────────── */
.player-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 32px;
  padding: 0 clamp(32px, 5vw, 64px) 32px;
}
@media (min-width: 1024px) {
  .player-row { grid-template-columns: 1.6fr 1fr; }
}
.player-container { display: flex; flex-direction: column; gap: 12px; }

/* ─── Summary card ───────────────────────────── */
.summary-card {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 28px;
  background: var(--surface-card);
  border: 1px solid var(--hairline);
  border-radius: var(--r-2);
}
.summary-num {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-top: 8px;
}
.summary-num em {
  font-style: normal;
  font-size: clamp(56px, 6vw, 88px);
  line-height: 1;
  color: var(--ink);
}
.summary-num small {
  font-family: var(--sans);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--muted);
}
.summary-card .breakdown {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.summary-card .breakdown > div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--sans);
  font-size: 14px;
  color: var(--body);
}
.summary-card .breakdown .v { color: var(--ink); font-weight: 600; }
.summary-card .swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 8px;
  vertical-align: middle;
}
.summary-sources {
  font-size: 12px;
  line-height: 1.6;
  text-transform: none;
  letter-spacing: 0;
  color: var(--body);
}

/* ─── Filter bar ─────────────────────────────── */
.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 16px clamp(32px, 5vw, 64px);
  border-top: 1px solid var(--hairline);
  border-bottom: 1px solid var(--hairline);
  flex-wrap: wrap;
}
.filter-bar .left {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.filter-bar .right {
  font-family: var(--sans);
  font-size: 12px;
  color: var(--muted);
}
.filter-bar .filter-divider {
  display: inline-block;
  width: 1px;
  height: 18px;
  background: var(--hairline);
  margin: 0 8px;
}
.chip-on { /* default chip styling is already "on"; this is a marker class */ }
.chip-off {
  background: transparent;
  border-color: var(--hairline);
  color: var(--muted);
  opacity: 0.55;
}
.chip-off .num { color: var(--muted); }
.chip { cursor: pointer; user-select: none; transition: opacity 0.18s ease, color 0.18s ease, background 0.18s ease; }
.chip:hover { opacity: 1; }

/* ─── Grid of reference cards ────────────────── */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(640px, 100%), 1fr));
  gap: 24px;
  padding: 32px clamp(32px, 5vw, 64px);
}

/* ─── Reference card ─────────────────────────── */
.ref {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
  padding: 24px;
  background: var(--surface-card);
  border: 1px solid var(--hairline);
  border-left-width: 2px;
  border-radius: var(--r-2);
  position: relative;
  cursor: pointer;
  transition: border-color 0.18s ease;
}
@media (min-width: 768px) {
  .ref { grid-template-columns: 1fr 1.4fr; }
}
.ref:hover { border-color: var(--hairline-strong); }
.ref:focus-visible {
  outline: none;
  border-color: var(--ink);
  box-shadow: 0 0 0 2px var(--ink);
}
.ref-confirmed { border-left-color: var(--grad-peach); }
.ref-speculative { border-left-color: var(--grad-sky); opacity: 0.95; }
.ref-hidden { border-left-color: var(--error); opacity: 0.7; }

.ref-left { display: flex; flex-direction: column; gap: 8px; }
.ref-right { display: flex; flex-direction: column; gap: 12px; }

/* Frame thumb */
.thumb {
  aspect-ratio: 16/9;
  width: 100%;
  background-size: cover;
  background-position: center;
  background-color: var(--surface-strong);
  border-radius: var(--r-1);
  position: relative;
}
.tc-overlay {
  position: absolute;
  bottom: 8px;
  left: 8px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.6);
  font-family: var(--sans);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--ink);
  border-radius: 4px;
}

/* Palette swatches */
.palette {
  display: flex;
  gap: 4px;
  height: 24px;
}
.palette span {
  flex: 1;
  height: 100%;
  border-radius: 4px;
}
.palette-label {
  margin-top: 6px;
  font-size: 11px;
  letter-spacing: 0.88px;
}

/* Verdict line in card */
.ref-verdict-line {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  font-family: var(--sans);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--muted);
}
.verdict-marker { font-weight: 600; }
.verdict-marker.verdict-confirmed { color: var(--grad-peach); }
.verdict-marker.verdict-speculative { color: var(--grad-sky); }
.verdict-marker.verdict-hidden { color: var(--error); }

/* Card title row with optional Wikipedia thumb */
.ref-title-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.ref-title {
  font-size: clamp(22px, 2.4vw, 32px);
  line-height: 1.18;
  letter-spacing: -0.22px;
  margin: 0;
  color: var(--ink);
}
.ref-title em { font-style: italic; }
.ref-title-rejected {
  text-decoration: line-through;
  text-decoration-color: var(--error);
  text-decoration-thickness: 1px;
}
.wiki-thumb {
  width: 60px;
  height: 60px;
  border-radius: var(--r-1);
  object-fit: cover;
  opacity: 0.85;
  transition: opacity 0.18s ease;
  flex-shrink: 0;
}
.wiki-thumb:hover { opacity: 1; }

/* Card meta */
.ref-meta {
  font-family: var(--sans);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--muted);
}

/* Card reasoning */
.ref-reasoning {
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.5;
  color: var(--body);
  margin: 0;
  max-width: 60ch;
}

/* Evidence chips row */
.ev { display: flex; flex-wrap: wrap; gap: 6px; }

/* Confidence bar */
.conf {
  display: flex;
  gap: 12px;
  align-items: center;
  font-family: var(--sans);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--muted);
}
.conf .bar {
  flex: 1;
  height: 2px;
  background: var(--hairline);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.conf .bar i {
  display: block;
  height: 100%;
  background: var(--grad-peach);
}
.conf-cyan .bar i { background: var(--grad-sky); }
.conf-rose .bar i { background: var(--error); }

/* Card action links */
.ref-actions {
  display: flex;
  gap: 14px;
  margin-top: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.ulink {
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid var(--hairline-strong);
  padding-bottom: 2px;
  font-family: var(--sans);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  cursor: pointer;
  transition: border-color 0.18s ease;
}
.ulink:hover { border-bottom-color: var(--ink); }
.ulink-muted { color: var(--muted); }
.ulink-muted:hover { color: var(--body); }

/* ─── Report footer ──────────────────────────── */
.report-footer {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 24px;
  padding: 24px clamp(32px, 5vw, 64px);
  border-top: 1px solid var(--hairline);
  font-family: var(--sans);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--muted);
}

/* ─── Slate context + action for report ──────── */
.slate-context {
  color: var(--ink);
  font-family: var(--sans);
  font-size: 14px;
  font-weight: 500;
}
.slate-action {
  background: none;
  border: none;
  color: var(--body);
  font-family: var(--sans);
  font-size: 14px;
  cursor: pointer;
  padding: 0;
  text-decoration: none;
}
.slate-action:hover { color: var(--ink); }

@media (max-width: 639px) {
  .slate .slate-context,
  .slate .slate-action { display: none; }
}
```

- [ ] **Step 3: Smoke-check the dev server**

Hot reload should pick up the new CSS. There's no consumer yet for most of these classes (Task 13 will render them), but they should compile without error. Verify backend running:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```
Expected: 200.

- [ ] **Step 4: Run tests + tsc**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(frontend): add report-specific CSS classes (player-row, ref card, filter bar)"
```

---

### Task 13: Rewrite ReportPage + delete obsolete components

**Files:**
- Modify: `frontend/app/report/[id]/page.tsx` (full rewrite)
- Delete: `frontend/components/ConfidenceFilter.tsx`
- Delete: `frontend/components/ReferencePanel.tsx`
- Delete: `frontend/components/ReferencePanel.test.tsx`

**Why:** This is the visible deliverable — the new report layout assembled from Slate + Header + PlayerRow + FilterBar + Grid + Footer. Old binary filter + reference panel components are obsolete.

- [ ] **Step 1: Read the existing types.ts to understand Confidence type**

Verify `Confidence` is exported from `@/lib/types` (it should be — it's used everywhere). If it's a discriminated union, ensure casts use the same names.

- [ ] **Step 2: Replace `/home/louis/clip-decoder/frontend/app/report/[id]/page.tsx` entirely**

```typescript
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  fetchReport,
  flagReference,
  subscribePipeline,
} from "@/lib/api";
import type {
  Confidence,
  FrameAnalysis,
  PipelineEvent,
  Report,
  VerifiedReference,
} from "@/lib/types";
import { computeReportStats } from "@/lib/reportStats";
import { PipelineStatus } from "@/components/PipelineStatus";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";
import { FilterBar } from "@/components/FilterBar";
import { SummaryCard } from "@/components/SummaryCard";
import { ReferenceCard } from "@/components/ReferenceCard";

function formatDuration(s: number): string {
  const t = Math.floor(s);
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "recently";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "recently";
  }
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState(false);
  const playerRef = useRef<VideoPlayerHandle>(null);

  useEffect(() => {
    let cancelled = false;
    let close: (() => void) | undefined;

    async function load() {
      const r = await fetchReport(id);
      if (cancelled) return;
      if (r) {
        setReport(r);
        return;
      }
      close = subscribePipeline(
        id,
        async (e) => {
          if (cancelled) return;
          setEvents((prev) => [...prev, e]);
          if (e.step === "done") {
            const fresh = await fetchReport(id);
            if (!cancelled) setReport(fresh);
          }
          if (e.step === "error") setError(e.message);
        },
        (err) => !cancelled && setError(String(err)),
      );
    }
    void load();
    return () => {
      cancelled = true;
      close?.();
    };
  }, [id]);

  const stats = useMemo(() => (report ? computeReportStats(report) : null), [report]);

  const [selectedVerdicts, setSelectedVerdicts] = useState<Set<Confidence>>(
    new Set<Confidence>(["confirmed", "speculative"]),
  );
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  // Initialize selectedTypes to all available types once the report loads
  useEffect(() => {
    if (stats && selectedTypes.size === 0 && stats.availableTypes.length > 0) {
      setSelectedTypes(new Set(stats.availableTypes));
    }
  }, [stats, selectedTypes.size]);

  // Build a lookup of FrameAnalysis by frame_id for palette joining
  const frameById = useMemo(() => {
    const m = new Map<string, FrameAnalysis>();
    if (report) {
      for (const f of report.frame_analyses) m.set(f.frame_id, f);
    }
    return m;
  }, [report]);

  const filteredRefs = useMemo(() => {
    if (!report) return [];
    return report.references
      .filter((r) => selectedVerdicts.has(r.final_confidence as Confidence))
      .filter((r) => selectedTypes.has(r.work_type))
      .sort((a, b) => a.timestamp_s - b.timestamp_s);
  }, [report, selectedVerdicts, selectedTypes]);

  function toggleVerdict(v: Confidence) {
    setSelectedVerdicts((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  }
  function toggleType(t: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  function jumpTo(ref: VerifiedReference) {
    playerRef.current?.seekTo(ref.timestamp_s);
  }
  async function handleFlag(idx: number) {
    await flagReference(id, idx);
  }
  async function shareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }

  function Slate({ youtubeId, duration, shots, refs }: { youtubeId: string; duration: number; shots: number; refs: number }) {
    return (
      <div className="slate">
        <span className="dot" />
        <b>ClipDecoder</b>
        <span className="slate-context">Report</span>
        <span className="sep" />
        <span className="tc">{youtubeId}</span>
        <span className="tc">{formatDuration(duration)}</span>
        <span className="tc">{shots} shots · {refs} references</span>
        <span className="sep" />
        <button type="button" className="slate-action" onClick={shareLink}>
          {shareToast ? "Link copied" : "Share ↗"}
        </button>
        <a className="slate-action" href={`/api/report/${id}`} target="_blank" rel="noopener noreferrer">
          Raw JSON
        </a>
      </div>
    );
  }

  // Loading state
  if (!report && !error) {
    return (
      <main className="frame surface-dark relative min-h-screen flex flex-col">
        <div className="slate">
          <span className="dot" />
          <b>ClipDecoder</b>
          <span className="slate-context">Report</span>
          <span className="sep" />
          <span className="tc">{id}</span>
        </div>
        <div style={{ padding: "clamp(32px, 5vw, 64px)" }}>
          <PipelineStatus events={events} />
        </div>
      </main>
    );
  }

  // Error state
  if (error) {
    return (
      <main className="frame surface-dark relative min-h-screen flex flex-col">
        <div className="slate">
          <span className="dot" />
          <b>ClipDecoder</b>
          <span className="slate-context">Report</span>
          <span className="sep" />
          <span className="tc">{id}</span>
        </div>
        <div style={{ padding: "clamp(32px, 5vw, 64px)", maxWidth: 720 }}>
          <div className="hairline" style={{ marginBottom: 16, color: "var(--error)" }}>
            Pipeline error
          </div>
          <h1 className="serif-it" style={{ fontSize: "clamp(28px, 4vw, 48px)", color: "var(--ink)" }} role="alert">
            {error}
          </h1>
          <Link className="ulink" href="/" style={{ marginTop: 24, display: "inline-block" }}>
            ← Try another clip
          </Link>
        </div>
      </main>
    );
  }

  // Successful render
  if (!report || !stats) return null;

  return (
    <main className="frame surface-dark relative min-h-screen flex flex-col">
      <Slate youtubeId={report.youtube_id} duration={report.duration_s} shots={stats.shots} refs={stats.total} />

      <header className="report-header">
        <h1 className="serif-it report-h1">
          A clip you'd<br />like <em style={{ color: "var(--grad-lavender)", fontStyle: "italic" }}>decoded.</em>
        </h1>
        <h2 className="serif-it report-title">{report.title}</h2>
        <div className="report-meta">
          <span>{report.channel}</span>
          <span>·</span>
          <span>{formatDuration(report.duration_s)}</span>
          <span>·</span>
          <span>{stats.shots} shots</span>
          <span>·</span>
          <span>Analysed {formatDate(report.created_at)}</span>
          {stats.wikiHits > 0 && (
            <>
              <span>·</span>
              <span>Wikipedia verified ({stats.wikiHits}/{stats.total})</span>
            </>
          )}
        </div>
      </header>

      <section className="player-row">
        <div className="player-container">
          <VideoPlayer ref={playerRef} youtubeId={report.youtube_id} />
          <p className="hairline">Click any reference card to seek the player</p>
        </div>
        <SummaryCard stats={stats} />
      </section>

      <FilterBar
        verdictCounts={{ confirmed: stats.confirmed, speculative: stats.speculative, hidden: stats.hidden }}
        typeCounts={Object.fromEntries(stats.typeBreakdown.map((t) => [t.type, t.count]))}
        availableTypes={stats.availableTypes}
        selectedVerdicts={selectedVerdicts}
        selectedTypes={selectedTypes}
        onToggleVerdict={toggleVerdict}
        onToggleType={toggleType}
      />

      <div className="grid">
        {filteredRefs.length === 0 ? (
          <div className="hairline" style={{ gridColumn: "1/-1", textAlign: "center", padding: 48 }}>
            All references filtered out. Re-enable a chip above.
          </div>
        ) : (
          filteredRefs.map((ref) => {
            const frame = frameById.get(ref.source_frame_id);
            const paletteHex = frame?.palette_hex ?? [];
            const paletteDescriptors = frame?.palette ?? [];
            const idx = report.references.indexOf(ref);
            return (
              <ReferenceCard
                key={`${ref.source_frame_id}-${idx}`}
                reference={ref}
                paletteHex={paletteHex}
                paletteDescriptors={paletteDescriptors}
                youtubeId={report.youtube_id}
                onJump={() => jumpTo(ref)}
                onFlag={() => handleFlag(idx)}
              />
            );
          })
        )}
      </div>

      <footer className="report-footer">
        <span>Run · {report.youtube_id}</span>
        <span>Wikipedia hits · {stats.wikiHits} / {stats.total}</span>
        <span>
          References · {stats.confirmed} confirmed · {stats.speculative} speculative · {stats.hidden} hidden
        </span>
      </footer>
    </main>
  );
}
```

- [ ] **Step 3: Delete the obsolete components**

```bash
rm /home/louis/clip-decoder/frontend/components/ConfidenceFilter.tsx
rm /home/louis/clip-decoder/frontend/components/ReferencePanel.tsx
rm /home/louis/clip-decoder/frontend/components/ReferencePanel.test.tsx
```

- [ ] **Step 4: TypeScript check**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
```
Expected: zero errors. If there are errors about missing imports of `ConfidenceFilter` / `ReferencePanel` somewhere else, grep for them:

```bash
grep -rn "ConfidenceFilter\|ReferencePanel" /home/louis/clip-decoder/frontend/ --include='*.tsx' --include='*.ts'
```
Expected: zero hits.

- [ ] **Step 5: Run tests**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: all tests pass. The deleted `ReferencePanel.test.tsx` is gone, so test count drops; FilterBar + reportStats tests should run.

- [ ] **Step 6: Smoke-check the dev server**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/report/test123
```
Expected: 200. The page will render the loading state (since "test123" isn't a real run) — that's fine, just verifies no compile error.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/report/[id]/page.tsx
git rm frontend/components/ConfidenceFilter.tsx frontend/components/ReferencePanel.tsx frontend/components/ReferencePanel.test.tsx
git commit -m "feat(frontend): rewrite report page with new editorial design + multi-axes filters"
```

---

### Task 14: Minor reskin of PipelineStatus

**Files:**
- Modify: `frontend/components/PipelineStatus.tsx`

**Why:** During loading the user sees `PipelineStatus`. Right now it uses legacy `tracking-mono-label`, `font-mono`, etc. Quick swap to the new primitives (`.uc`, `.hairline`, `.serif-it`). Logic unchanged.

- [ ] **Step 1: Read PipelineStatus.tsx and identify legacy classes**

Open `/home/louis/clip-decoder/frontend/components/PipelineStatus.tsx`. Find lines using:
- `font-mono` → replace with `var(--sans)` via the `.uc` or `.hairline` classes
- `tracking-mono-label` → already covered by `.uc` / `.hairline`
- `font-display` → replace with `.serif-it` or remove
- `text-white/55` / `text-white/40` etc. → replace with `color: var(--body)` / `var(--muted)` via inline style or new utilities

- [ ] **Step 2: Do a targeted reskin**

Replace each legacy className+inline-style cluster with either:
- `className="uc"` (uppercase muted small text)
- `className="hairline"` (same look, slightly different semantic)
- `className="serif-it"` for the main title/heading
- Direct `style={{ color: "var(--ink)" }}` or `var(--body)` for body text

Keep the JSX structure (which events to show, animations, layout) **exactly as it is**. Only the className/style attributes change.

If the file has complex animations (steps progressing visually), keep them — they're appropriate during loading.

- [ ] **Step 3: Run TypeScript + tests + smoke**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run components/PipelineStatus
```
Expected: zero TS errors, existing PipelineStatus tests still pass.

Visually verify by hitting a non-existent report `http://localhost:3000/report/test123` in browser (the loading state appears since there's no row yet, then transitions to error).

- [ ] **Step 4: Commit**

```bash
git add frontend/components/PipelineStatus.tsx
git commit -m "chore(frontend): reskin PipelineStatus to use SP1 primitive classes"
```

---

### Task 15: Final grep audit + manual verification + cleanup

**Files:**
- No modifications expected. Verification only.

**Why:** Catch any stale references, run the full test suite end-to-end, walk through the manual checklist on a real video.

- [ ] **Step 1: Grep audit for stale legacy references**

Run from repo root:
```bash
cd /home/louis/clip-decoder/frontend && \
  grep -rn 'ConfidenceFilter\|ReferencePanel\|tracking-mono-label\|tracking-display\|tracking-body\|font-display\|font-mono\|reveal-child\|bg-deep-sky\|text-aurora\|glass-dark\|wordmark-foot' \
  app components --include='*.tsx' --include='*.ts'
```

Expected: zero hits, OR only hits inside `PipelineStatus.tsx` that Task 14 was meant to clean (in which case go back and finish them).

If hits remain in unrelated files, list them and proceed if they're not in the touched scope of SP2.

- [ ] **Step 2: Run full backend test suite**

```bash
docker exec clip-decoder-backend-1 python -m pytest -v
```
Expected: all green. New tests visible: `test_palette.py` (3), `test_verifier.py::test_wikipedia_thumb*` (2), `test_frames_endpoint.py` (4), updated `test_get_report*` (1).

- [ ] **Step 3: Run full frontend test suite**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/vitest run
```
Expected: all green. New tests visible: `FilterBar.test.tsx` (3), `reportStats.test.ts` (4). Removed: `ReferencePanel.test.tsx` (-4). Net frontend delta: +3.

- [ ] **Step 4: TypeScript check**

```bash
docker exec clip-decoder-frontend-1 /app/node_modules/.bin/tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 5: Manual end-to-end verification**

Open `http://localhost:3000` in a browser. Run through this checklist:

**Landing → report flow:**
- [ ] Paste a YouTube URL (e.g., `https://www.youtube.com/watch?v=QHuo2pIyTH8`) → click Decode → redirect to `/report/{id}`.
- [ ] Loading state visible: slate top bar, PipelineStatus events streaming.
- [ ] Once pipeline finishes, the report renders.

**Slate:**
- [ ] Dot peach→rose, ClipDecoder bold, "Report" context label, youtube_id + duration + count tcs.
- [ ] Click "Share ↗" → "Link copied" appears for 2s, then reverts. Clipboard contains the page URL.
- [ ] Click "Raw JSON" → opens `/api/report/{id}` in a new tab as JSON (includes `created_at` field).

**Header:**
- [ ] Decorative h1 "A clip you'd like decoded." with "decoded." in lavender.
- [ ] Subtitle: actual video title in serif italic.
- [ ] Meta line: channel · duration · N shots · "Analysed {date}" · Wikipedia verified (M/N).

**Player row:**
- [ ] Video player on left, summary card on right.
- [ ] Click any reference card → player seeks to that timestamp.
- [ ] Summary card shows: "References found" + big number total + breakdown rows + sources span "1929 → 2014 · 3 films · 2 paintings · ..."

**Filter bar:**
- [ ] 3 verdict chips (Confirmed peach, Speculative cyan, Hidden dim). Confirmed + Speculative shown as "on" (full color); Hidden shown as "off" (faded).
- [ ] N work_type chips (whatever types are in this report). All "on" by default.
- [ ] Click "Hidden" → hidden refs appear in grid (line-through title, grayscale thumb).
- [ ] Click a work_type chip → cards of that type disappear.
- [ ] Click again → cards reappear.

**Grid + cards:**
- [ ] Each card shows: thumb (loads from `/api/frames/...`), tc-overlay overlay, palette 5 hex swatches, palette-label hairline if descriptors present.
- [ ] Right side: verdict marker with colored icon, work_type, "Wikipedia verified" (if URL present).
- [ ] Italic serif title with Wikipedia mini-thumb 60×60 next to it (if URL present).
- [ ] Meta: creator · year · type.
- [ ] Reasoning paragraph.
- [ ] Evidence chips below (chip-cyan for speculative, chip-dim for hidden).
- [ ] Confidence bar colored by verdict (peach / sky / error).
- [ ] Actions: "▸ JUMP TO {tc}" works (seeks player), "WIKIPEDIA ↗" opens in new tab, "NOT CONVINCED ✕" flags ref (moves to hidden).

**Footer:**
- [ ] "Run · {youtube_id}" · "Wikipedia hits · M/N" · "References · X confirmed · Y speculative · Z hidden".

**Mobile (≤640px):**
- [ ] Slate compacts (Share / Raw JSON hidden).
- [ ] Grid becomes 1 column.
- [ ] Player-row stacks player above summary card.
- [ ] Filter bar wraps chips.
- [ ] Reference card collapses to 1 column.

**Reduced motion:**
- [ ] DevTools → Rendering → Emulate `prefers-reduced-motion: reduce` → orbs static (no drift).

- [ ] **Step 6: If any visual or functional issue found**

Note the issue, fix it directly in the relevant file, run the affected test, commit:

```bash
git add <files>
git commit -m "fix(frontend): <description of fix>"
```

If no issues, no commit needed for this task.

- [ ] **Step 7: Final summary commit (optional)**

If you'd like a marker for the end of SP2 work:

```bash
git commit --allow-empty -m "chore: SP2 design system migration (report enriched) complete"
```

(Optional — the merge commit at branch-merge time serves the same purpose.)

---

## Self-review

After writing all 15 tasks, controller verifies:

**1. Spec coverage:**

- Backend dependencies (`Pillow`/`numpy`/`scikit-learn`) → Task 1
- `palette_hex` + `wikipedia_thumbnail_url` Pydantic fields → Task 2
- `palette.py` module with KMeans → Task 3
- Palette integrated in `frame_analyzer.py` (NOT shot_sampler) → Task 4
- Wikipedia thumbnail parsed in verifier → Task 5
- `GET /api/frames/{youtube_id}/{frame_id}` with regex validation + Cache-Control → Task 6
- `/api/report/{youtube_id}` extended with `created_at` from `AnalysisRow` → Task 7
- Frontend types extension + `computeReportStats` helper + tests → Task 8
- `FilterBar` multi-axes component + tests → Task 9
- `SummaryCard` derived display → Task 10
- `ReferenceCard` rewrite (thumb + palette + verdict + actions) → Task 11
- `globals.css` report-specific classes → Task 12
- `ReportPage` rewrite (Slate + Header + PlayerRow + FilterBar + Grid + Footer) → Task 13
- Obsolete `ConfidenceFilter` / `ReferencePanel` deleted → Task 13
- Tier-3 trivial (Share + Raw JSON) implemented in Slate → Task 13
- `PipelineStatus` minor reskin → Task 14
- Grep audit + manual verification → Task 15

**2. Placeholder scan:** Every code step has actual code. Every test step has actual test code. Every verification step has the exact command. No "TBD".

**3. Type consistency:**
- `Confidence` type from `@/lib/types` is the same union used across `FilterBar`, `ReportPage`, `computeReportStats`. Spelled identically everywhere ("confirmed" | "speculative" | "hidden").
- `ReferenceCard` props match what `ReportPage` passes: `reference`, `paletteHex`, `paletteDescriptors`, `youtubeId`, `onJump`, `onFlag`.
- `FilterBarProps` interface in Task 9 exactly matches the usage in Task 13.
- `ReportStats` returned by `computeReportStats` (Task 8) has the exact fields consumed by `SummaryCard` (Task 10) and `ReportPage` filter UI (Task 13).
- Backend route paths: spec uses `/api/frames/...` and `/api/report/...`; implementation uses `@router.get("/frames/...")` and `@router.get("/report/...")` because router has `prefix="/api"`.
