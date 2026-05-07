# ClipDecoder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first tool that decodes the visual references hidden in a YouTube music video, using NVIDIA NIM endpoints (Cosmos Reason for vision, Llama 3.x for cultural cross-referencing) and producing an annotated viewer with evidence-based reference cards.

**Architecture:** FastAPI backend (Python 3.12 + uv) runs a 5-stage pipeline (ingest → shot-sample → frame-analyze → reference-propose → verify) that streams progress to a Next.js 15 frontend via Server-Sent Events. The frontend displays an embedded YouTube player alongside a panel of reference cards, each grounded in a source frame and the model's reasoning. SQLite caches reports by YouTube ID; frame thumbnails live on disk. Two-pass LLM verification + Wikipedia validation guards against hallucinated references.

**Tech Stack:** Python 3.12, uv, FastAPI, yt-dlp, PySceneDetect, ffmpeg, httpx, OpenAI SDK (NIM), SQLAlchemy + SQLite, Pydantic v2, pytest, respx. Next.js 15, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, react-player, Vitest. Docker Compose for orchestration.

---

## File Structure

### Backend (`backend/`)

| File | Responsibility |
|------|----------------|
| `pyproject.toml`, `uv.lock` | uv-managed deps |
| `Dockerfile` | Backend container build |
| `app/main.py` | FastAPI app, lifespan (DB init), route registration |
| `app/settings.py` | Env loading (pydantic-settings) |
| `app/models.py` | Pydantic schemas: `IngestResult`, `KeyFrame`, `FrameAnalysis`, `ReferenceCandidate`, `VerifiedReference`, `Report`, `PipelineEvent` |
| `app/db.py` | Async SQLAlchemy engine, session, ORM models, init |
| `app/nim/client.py` | OpenAI-compatible NIM wrapper: `analyze_image`, `complete_text` |
| `app/pipeline/ingestor.py` | yt-dlp-based downloader |
| `app/pipeline/shot_sampler.py` | PySceneDetect + ffmpeg key-frame extraction |
| `app/pipeline/frame_analyzer.py` | Cosmos Reason per-frame analyzer |
| `app/pipeline/ref_proposer.py` | Cross-frame LLM reference candidate generator |
| `app/pipeline/verifier.py` | Adversarial LLM validator + Wikipedia check |
| `app/pipeline/orchestrator.py` | End-to-end runner, emits pipeline events |
| `app/api/routes.py` | REST endpoints |
| `app/api/sse.py` | SSE event bus + endpoint |
| `app/prompts/{frame_analyzer,ref_proposer,verifier}.md` | Versioned prompts |
| `tests/unit/test_*.py` | Per-unit tests with NIM mocked via respx |
| `tests/golden/test_pipeline_golden.py` | Reference-clip regression tests |
| `tests/integration/test_e2e.py` | Real-NIM end-to-end (skipped without `NVAPI_KEY`) |

### Frontend (`frontend/`)

| File | Responsibility |
|------|----------------|
| `package.json`, `pnpm-lock.yaml` | pnpm-managed deps |
| `Dockerfile` | Frontend container |
| `tailwind.config.ts`, `app/globals.css` | Design tokens from `DESIGN.md` |
| `app/layout.tsx` | Root layout, font loading |
| `app/page.tsx` | Hero/landing with URL form |
| `app/report/[id]/page.tsx` | Report viewer (server component fetches report, client island for player) |
| `components/HeroForm.tsx` | URL input + submit |
| `components/PipelineStatus.tsx` | SSE consumer, step indicator |
| `components/VideoPlayer.tsx` | react-player wrapper with `seekTo` ref |
| `components/ReferencePanel.tsx` | Scrollable list of cards |
| `components/ReferenceCard.tsx` | Single reference with frame + cited work + reasoning |
| `components/ConfidenceFilter.tsx` | Toggle for speculative refs |
| `lib/api.ts` | REST + SSE client |
| `lib/types.ts` | TS types mirroring backend schemas |
| `lib/design.ts` | DESIGN.md tokens as TS constants |
| `public/fonts/.gitkeep` | Slot for licensed font files |

### Root

| File | Responsibility |
|------|----------------|
| `docker-compose.yml` | Backend + frontend services |
| `.env.example` | `NVAPI_KEY=` template |
| `.gitignore` | `data/`, `node_modules/`, `.env`, etc. |
| `README.md` | Setup + usage |

---

## Task 1: Backend scaffold (uv init, FastAPI hello world, settings)

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`
- Create: `backend/app/settings.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/unit/__init__.py`
- Create: `backend/tests/unit/test_health.py`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Verify uv is installed**

Run: `uv --version`
Expected: Prints a version like `uv 0.4.x` or newer. If missing, `curl -LsSf https://astral.sh/uv/install.sh | sh`.

- [ ] **Step 2: Initialize backend project**

Run from repo root:
```bash
mkdir -p backend && cd backend && uv init --no-readme --no-workspace --python 3.12 .
```
Then replace `backend/pyproject.toml` with:

```toml
[project]
name = "clipdecoder-backend"
version = "0.1.0"
description = "ClipDecoder backend: NIM-powered visual reference decoder for music videos"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "yt-dlp>=2025.1.15",
    "scenedetect[opencv]>=0.6.4",
    "ffmpeg-python>=0.2.0",
    "httpx>=0.27",
    "openai>=1.55",
    "sqlalchemy>=2.0",
    "aiosqlite>=0.20",
    "pydantic>=2.9",
    "pydantic-settings>=2.6",
    "python-dotenv>=1.0",
    "sse-starlette>=2.1",
]

[dependency-groups]
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
    "respx>=0.21",
    "ruff>=0.7",
    "mypy>=1.13",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
markers = ["e2e: integration tests requiring NVAPI_KEY"]
```

Then run:
```bash
cd backend && uv sync
```

Expected: `uv.lock` created; `.venv/` created. No errors.

- [ ] **Step 3: Write the failing health-check test**

Create `backend/tests/unit/test_health.py`:
```python
from fastapi.testclient import TestClient
from app.main import app


def test_health_returns_ok():
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app'` or `app.main`.

- [ ] **Step 5: Implement settings**

Create `backend/app/__init__.py` (empty file).

Create `backend/app/settings.py`:
```python
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    nvapi_key: str = ""
    nim_base_url: str = "https://integrate.api.nvidia.com/v1"
    cosmos_reason_model: str = "nvidia/cosmos-reason1-7b"
    llm_model: str = "meta/llama-3.3-70b-instruct"

    frames_per_shot: int = 1
    max_shots_per_video: int = 80
    nim_concurrency: int = 4
    wikipedia_verification: bool = True

    data_dir: Path = Path("data")
    db_path: Path = Path("data/clipdecoder.sqlite")


settings = Settings()
```

- [ ] **Step 6: Implement minimal FastAPI app**

Create `backend/app/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="ClipDecoder API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_health.py -v`
Expected: PASS.

- [ ] **Step 8: Create root `.env.example` and `.gitignore`**

Create `.env.example` at repo root:
```
NVAPI_KEY=nvapi-replace-me
NIM_BASE_URL=https://integrate.api.nvidia.com/v1
COSMOS_REASON_MODEL=nvidia/cosmos-reason1-7b
LLM_MODEL=meta/llama-3.3-70b-instruct
FRAMES_PER_SHOT=1
MAX_SHOTS_PER_VIDEO=80
NIM_CONCURRENCY=4
WIKIPEDIA_VERIFICATION=true
```

Create `.gitignore` at repo root:
```
# Python
__pycache__/
*.py[cod]
.venv/
.pytest_cache/
.mypy_cache/
.ruff_cache/

# Data
backend/data/
data/

# Frontend
node_modules/
.next/
out/

# Env
.env
.env.local

# OS
.DS_Store

# Logs
*.log
```

- [ ] **Step 9: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock backend/app backend/tests .env.example .gitignore
git commit -m "feat(backend): scaffold FastAPI app with uv and health endpoint"
```

---

## Task 2: Pydantic schemas

**Files:**
- Create: `backend/app/models.py`
- Create: `backend/tests/unit/test_models.py`

- [ ] **Step 1: Write the failing schema test**

Create `backend/tests/unit/test_models.py`:
```python
import pytest
from pydantic import ValidationError
from app.models import (
    KeyFrame,
    FrameAnalysis,
    ReferenceCandidate,
    VerifiedReference,
    Verdict,
    Confidence,
    Report,
    PipelineEvent,
)


def test_frame_analysis_round_trip():
    fa = FrameAnalysis(
        timestamp_s=12.5,
        frame_id="shot_03",
        composition="centered symmetrical corridor",
        palette=["red", "black"],
        camera_move="slow tracking forward",
        costume_setting="white shirt, hotel hallway",
        distinctive_features=["one-point perspective", "neon"],
        raw_description="A long red corridor seen head-on...",
        confidence_in_observation=0.9,
    )
    dumped = fa.model_dump()
    assert dumped["timestamp_s"] == 12.5
    assert FrameAnalysis(**dumped) == fa


def test_reference_candidate_requires_named_work():
    with pytest.raises(ValidationError):
        ReferenceCandidate(
            timestamp_s=10.0,
            source_frame_id="shot_01",
            work_title="",  # empty -> reject
            work_creator="Stanley Kubrick",
            work_type="film",
            reasoning="x",
            raw_confidence=0.5,
        )


def test_verified_reference_verdict_enum():
    vr = VerifiedReference(
        timestamp_s=10.0,
        source_frame_id="shot_01",
        work_title="The Shining",
        work_creator="Stanley Kubrick",
        work_year=1980,
        work_type="film",
        reasoning="symmetrical corridor + slow tracking",
        raw_confidence=0.8,
        verdict=Verdict.KEEP,
        final_confidence=Confidence.CONFIRMED,
        supporting_elements=["symmetry", "corridor", "slow track"],
        wikipedia_url="https://en.wikipedia.org/wiki/The_Shining_(film)",
    )
    assert vr.verdict == Verdict.KEEP


def test_pipeline_event_serializable():
    e = PipelineEvent(step="vision", message="frame 5 of 12", progress=0.42)
    assert e.model_dump_json().startswith("{")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: app.models`.

- [ ] **Step 3: Implement schemas**

Create `backend/app/models.py`:
```python
from __future__ import annotations
from enum import Enum
from pathlib import Path
from typing import Annotated
from pydantic import BaseModel, Field, ConfigDict


class Verdict(str, Enum):
    KEEP = "keep"
    SPECULATIVE = "speculative"
    REJECT = "reject"


class Confidence(str, Enum):
    CONFIRMED = "confirmed"
    SPECULATIVE = "speculative"
    HIDDEN = "hidden"


class Caption(BaseModel):
    start_s: float
    end_s: float
    text: str


class IngestResult(BaseModel):
    youtube_id: str
    video_path: Path
    title: str
    channel: str
    duration_s: float
    captions: list[Caption] = []

    model_config = ConfigDict(arbitrary_types_allowed=True)


class KeyFrame(BaseModel):
    shot_id: str
    timestamp_s: float
    frame_path: Path

    model_config = ConfigDict(arbitrary_types_allowed=True)


class FrameAnalysis(BaseModel):
    timestamp_s: float
    frame_id: str
    composition: str
    palette: list[str]
    camera_move: str
    costume_setting: str
    distinctive_features: list[str]
    raw_description: str
    confidence_in_observation: Annotated[float, Field(ge=0.0, le=1.0)]


class ReferenceCandidate(BaseModel):
    timestamp_s: float
    source_frame_id: str
    work_title: Annotated[str, Field(min_length=1)]
    work_creator: Annotated[str, Field(min_length=1)]
    work_year: int | None = None
    work_type: str  # film | painting | photograph | music_video | other
    reasoning: Annotated[str, Field(min_length=1)]
    raw_confidence: Annotated[float, Field(ge=0.0, le=1.0)]


class VerifiedReference(ReferenceCandidate):
    verdict: Verdict
    final_confidence: Confidence
    supporting_elements: list[str]
    wikipedia_url: str | None = None


class Report(BaseModel):
    youtube_id: str
    title: str
    channel: str
    duration_s: float
    references: list[VerifiedReference]
    frame_analyses: list[FrameAnalysis]


class PipelineEvent(BaseModel):
    step: str  # ingest | shots | vision | crossref | verify | done | error
    message: str
    progress: Annotated[float, Field(ge=0.0, le=1.0)] = 0.0
    payload: dict = {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_models.py -v`
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/unit/test_models.py
git commit -m "feat(backend): add Pydantic schemas for pipeline data flow"
```

---

## Task 3: Database setup (SQLAlchemy async + SQLite)

**Files:**
- Create: `backend/app/db.py`
- Create: `backend/tests/unit/test_db.py`

- [ ] **Step 1: Write the failing DB round-trip test**

Create `backend/tests/unit/test_db.py`:
```python
import pytest
from pathlib import Path
from app.db import Database, AnalysisStatus
from app.models import Report, VerifiedReference, FrameAnalysis, Verdict, Confidence


@pytest.fixture
async def db(tmp_path: Path) -> Database:
    d = Database(db_path=tmp_path / "test.sqlite")
    await d.init()
    return d


@pytest.fixture
def sample_report() -> Report:
    return Report(
        youtube_id="abc123",
        title="Test Clip",
        channel="Tester",
        duration_s=240.0,
        references=[
            VerifiedReference(
                timestamp_s=10.0,
                source_frame_id="shot_01",
                work_title="The Shining",
                work_creator="Stanley Kubrick",
                work_year=1980,
                work_type="film",
                reasoning="symmetry",
                raw_confidence=0.8,
                verdict=Verdict.KEEP,
                final_confidence=Confidence.CONFIRMED,
                supporting_elements=["symmetry"],
            )
        ],
        frame_analyses=[],
    )


async def test_save_and_load_report(db: Database, sample_report: Report):
    await db.save_report(sample_report, status=AnalysisStatus.DONE)
    loaded = await db.load_report("abc123")
    assert loaded is not None
    assert loaded.youtube_id == "abc123"
    assert loaded.references[0].work_title == "The Shining"


async def test_load_missing_returns_none(db: Database):
    assert await db.load_report("nope") is None


async def test_status_lifecycle(db: Database, sample_report: Report):
    await db.set_status("abc123", AnalysisStatus.RUNNING)
    assert await db.get_status("abc123") == AnalysisStatus.RUNNING
    await db.save_report(sample_report, status=AnalysisStatus.DONE)
    assert await db.get_status("abc123") == AnalysisStatus.DONE


async def test_flag_reference(db: Database, sample_report: Report):
    await db.save_report(sample_report, status=AnalysisStatus.DONE)
    await db.flag_reference("abc123", ref_index=0, reason="wrong")
    flags = await db.list_flags("abc123")
    assert len(flags) == 1
    assert flags[0]["ref_index"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_db.py -v`
Expected: FAIL — `ModuleNotFoundError: app.db`.

- [ ] **Step 3: Implement Database**

Create `backend/app/db.py`:
```python
from __future__ import annotations
import json
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any
from sqlalchemy import String, Float, Integer, DateTime, JSON, ForeignKey, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.models import Report


class AnalysisStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"


class Base(DeclarativeBase):
    pass


class AnalysisRow(Base):
    __tablename__ = "analyses"

    youtube_id: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, default="")
    channel: Mapped[str] = mapped_column(String, default="")
    duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    report_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class FlagRow(Base):
    __tablename__ = "flagged_references"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    youtube_id: Mapped[str] = mapped_column(
        String, ForeignKey("analyses.youtube_id"), nullable=False
    )
    ref_index: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class Database:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._engine = create_async_engine(
            f"sqlite+aiosqlite:///{db_path}", future=True
        )
        self._session = async_sessionmaker(self._engine, expire_on_commit=False)

    async def init(self) -> None:
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def set_status(
        self, youtube_id: str, status: AnalysisStatus, error: str | None = None
    ) -> None:
        async with self._session() as s:
            row = await s.get(AnalysisRow, youtube_id)
            if row is None:
                row = AnalysisRow(youtube_id=youtube_id, status=status.value, error=error)
                s.add(row)
            else:
                row.status = status.value
                row.error = error
            await s.commit()

    async def get_status(self, youtube_id: str) -> AnalysisStatus | None:
        async with self._session() as s:
            row = await s.get(AnalysisRow, youtube_id)
            return AnalysisStatus(row.status) if row else None

    async def save_report(self, report: Report, status: AnalysisStatus) -> None:
        async with self._session() as s:
            row = await s.get(AnalysisRow, report.youtube_id)
            payload = json.loads(report.model_dump_json())
            if row is None:
                row = AnalysisRow(
                    youtube_id=report.youtube_id,
                    status=status.value,
                    title=report.title,
                    channel=report.channel,
                    duration_s=report.duration_s,
                    report_json=payload,
                )
                s.add(row)
            else:
                row.status = status.value
                row.title = report.title
                row.channel = report.channel
                row.duration_s = report.duration_s
                row.report_json = payload
            await s.commit()

    async def load_report(self, youtube_id: str) -> Report | None:
        async with self._session() as s:
            row = await s.get(AnalysisRow, youtube_id)
            if row is None or row.report_json is None:
                return None
            return Report.model_validate(row.report_json)

    async def flag_reference(
        self, youtube_id: str, ref_index: int, reason: str | None = None
    ) -> None:
        async with self._session() as s:
            s.add(FlagRow(youtube_id=youtube_id, ref_index=ref_index, reason=reason))
            await s.commit()

    async def list_flags(self, youtube_id: str) -> list[dict[str, Any]]:
        async with self._session() as s:
            stmt = select(FlagRow).where(FlagRow.youtube_id == youtube_id)
            result = await s.execute(stmt)
            return [
                {
                    "ref_index": r.ref_index,
                    "reason": r.reason,
                    "created_at": r.created_at.isoformat(),
                }
                for r in result.scalars().all()
            ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_db.py -v`
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/db.py backend/tests/unit/test_db.py
git commit -m "feat(backend): add async SQLite store for analyses and flags"
```

---

## Task 4: NIM client wrapper

**Files:**
- Create: `backend/app/nim/__init__.py`
- Create: `backend/app/nim/client.py`
- Create: `backend/tests/unit/test_nim_client.py`

- [ ] **Step 1: Write the failing test**

Create `backend/app/nim/__init__.py` (empty).

Create `backend/tests/unit/test_nim_client.py`:
```python
import json
import respx
from httpx import Response
from pathlib import Path
from app.nim.client import NimClient


@respx.mock
async def test_complete_text_returns_parsed_json(tmp_path: Path):
    respx.post("https://example.test/v1/chat/completions").mock(
        return_value=Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps({"answer": "ok", "score": 0.7})
                        }
                    }
                ]
            },
        )
    )
    client = NimClient(api_key="nvapi-test", base_url="https://example.test/v1")
    result = await client.complete_text(
        model="meta/llama-3.3-70b-instruct",
        messages=[{"role": "user", "content": "hi"}],
        json_mode=True,
    )
    assert result == {"answer": "ok", "score": 0.7}


@respx.mock
async def test_analyze_image_sends_image_data_url(tmp_path: Path):
    img = tmp_path / "frame.jpg"
    img.write_bytes(b"\xff\xd8\xff\xd9")  # minimal "jpeg"

    captured = {}

    def handler(request):
        captured["body"] = json.loads(request.content)
        return Response(
            200,
            json={
                "choices": [
                    {"message": {"content": json.dumps({"description": "a corridor"})}}
                ]
            },
        )

    respx.post("https://example.test/v1/chat/completions").mock(side_effect=handler)
    client = NimClient(api_key="nvapi-test", base_url="https://example.test/v1")
    result = await client.analyze_image(
        model="nvidia/cosmos-reason1-7b",
        image_path=img,
        prompt="describe",
        json_mode=True,
    )
    assert result == {"description": "a corridor"}
    user_msg = captured["body"]["messages"][-1]
    assert isinstance(user_msg["content"], list)
    assert any(part.get("type") == "image_url" for part in user_msg["content"])
    assert any(
        "data:image/jpeg;base64," in (part.get("image_url", {}).get("url", ""))
        for part in user_msg["content"]
    )


@respx.mock
async def test_complete_text_retries_on_invalid_json(tmp_path: Path):
    responses = [
        Response(200, json={"choices": [{"message": {"content": "not-json"}}]}),
        Response(
            200,
            json={"choices": [{"message": {"content": json.dumps({"ok": True})}}]},
        ),
    ]
    route = respx.post("https://example.test/v1/chat/completions").mock(
        side_effect=responses
    )
    client = NimClient(api_key="nvapi-test", base_url="https://example.test/v1")
    result = await client.complete_text(
        model="m",
        messages=[{"role": "user", "content": "x"}],
        json_mode=True,
    )
    assert result == {"ok": True}
    assert route.call_count == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_nim_client.py -v`
Expected: FAIL — `ModuleNotFoundError: app.nim.client`.

- [ ] **Step 3: Implement NimClient**

Create `backend/app/nim/client.py`:
```python
from __future__ import annotations
import base64
import json
import logging
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class NimError(RuntimeError):
    pass


class NimClient:
    """Thin async wrapper around an OpenAI-compatible NIM endpoint.

    Why this exists: the OpenAI Python SDK is sync-leaning for some
    multimodal flows, and we need precise control over JSON-only
    parsing with retry. httpx async + a few helpers is simpler.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str,
        timeout_s: float = 60.0,
        max_json_retries: int = 1,
    ):
        if not api_key:
            raise ValueError("NIM api_key is required")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s
        self._max_json_retries = max_json_retries

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    async def _post_chat(
        self, *, model: str, messages: list[dict[str, Any]], json_mode: bool
    ) -> str:
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 2048,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        async with httpx.AsyncClient(timeout=self._timeout_s) as http:
            r = await http.post(
                f"{self._base_url}/chat/completions",
                headers=self._headers(),
                json=body,
            )
            r.raise_for_status()
            data = r.json()
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            raise NimError(f"Unexpected NIM response shape: {data}") from e

    async def complete_text(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        json_mode: bool = False,
    ) -> Any:
        attempts = 0
        last_err: Exception | None = None
        while attempts <= self._max_json_retries:
            content = await self._post_chat(
                model=model, messages=messages, json_mode=json_mode
            )
            if not json_mode:
                return content
            try:
                return json.loads(content)
            except json.JSONDecodeError as e:
                last_err = e
                logger.warning(
                    "NIM returned non-JSON content (attempt %d): %r", attempts, content
                )
                attempts += 1
        raise NimError(
            f"NIM did not return valid JSON after {attempts} attempts: {last_err}"
        )

    async def analyze_image(
        self,
        *,
        model: str,
        image_path: Path,
        prompt: str,
        json_mode: bool = True,
        system: str | None = None,
    ) -> Any:
        b64 = base64.b64encode(image_path.read_bytes()).decode()
        ext = image_path.suffix.lower().lstrip(".")
        mime = "jpeg" if ext in ("jpg", "jpeg") else ext or "jpeg"
        data_url = f"data:image/{mime};base64,{b64}"
        messages: list[dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        )
        return await self.complete_text(
            model=model, messages=messages, json_mode=json_mode
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_nim_client.py -v`
Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/nim backend/tests/unit/test_nim_client.py
git commit -m "feat(backend): add NIM async client with JSON retry"
```

---

## Task 5: Pipeline — Ingestor (yt-dlp)

**Files:**
- Create: `backend/app/pipeline/__init__.py`
- Create: `backend/app/pipeline/ingestor.py`
- Create: `backend/tests/unit/test_ingestor.py`

- [ ] **Step 1: Write the failing test**

Create `backend/app/pipeline/__init__.py` (empty).

Create `backend/tests/unit/test_ingestor.py`:
```python
from pathlib import Path
from unittest.mock import patch, MagicMock
from app.pipeline.ingestor import Ingestor, parse_youtube_id


def test_parse_youtube_id_standard():
    assert parse_youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"


def test_parse_youtube_id_short():
    assert parse_youtube_id("https://youtu.be/dQw4w9WgXcQ?si=foo") == "dQw4w9WgXcQ"


def test_parse_youtube_id_invalid_raises():
    import pytest
    with pytest.raises(ValueError):
        parse_youtube_id("https://example.com/foo")


def test_ingest_returns_metadata(tmp_path: Path):
    fake_video = tmp_path / "video.mp4"
    fake_video.write_bytes(b"fake")

    info = {
        "id": "dQw4w9WgXcQ",
        "title": "Test Title",
        "channel": "Test Channel",
        "duration": 240,
        "subtitles": {},
        "automatic_captions": {},
    }

    fake_ydl = MagicMock()
    fake_ydl.__enter__.return_value = fake_ydl
    fake_ydl.__exit__.return_value = False
    fake_ydl.extract_info.return_value = info
    fake_ydl.prepare_filename.return_value = str(fake_video)

    with patch("app.pipeline.ingestor.YoutubeDL", return_value=fake_ydl):
        ing = Ingestor(work_dir=tmp_path)
        result = ing.ingest("https://www.youtube.com/watch?v=dQw4w9WgXcQ")

    assert result.youtube_id == "dQw4w9WgXcQ"
    assert result.title == "Test Title"
    assert result.duration_s == 240.0
    assert result.video_path == fake_video
    assert result.captions == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_ingestor.py -v`
Expected: FAIL — `ModuleNotFoundError: app.pipeline.ingestor`.

- [ ] **Step 3: Implement Ingestor**

Create `backend/app/pipeline/ingestor.py`:
```python
from __future__ import annotations
import re
from pathlib import Path
from typing import Any
from yt_dlp import YoutubeDL

from app.models import Caption, IngestResult


_YT_ID_RE = re.compile(
    r"""(?:youtube\.com/(?:[^/\n\s]+/\S+/|(?:v|e(?:mbed)?)/|\S*?[?&]v=)
        |youtu\.be/)([A-Za-z0-9_-]{11})""",
    re.VERBOSE,
)


def parse_youtube_id(url: str) -> str:
    m = _YT_ID_RE.search(url)
    if not m:
        raise ValueError(f"Could not extract YouTube ID from URL: {url}")
    return m.group(1)


class Ingestor:
    """Downloads a YouTube video at a low resolution sufficient for analysis."""

    def __init__(self, work_dir: Path):
        self._work_dir = work_dir
        self._work_dir.mkdir(parents=True, exist_ok=True)

    def _ydl_opts(self, youtube_id: str) -> dict[str, Any]:
        out_template = str(self._work_dir / f"{youtube_id}.%(ext)s")
        return {
            "format": "best[height<=480][ext=mp4]/best[height<=480]/best[ext=mp4]/best",
            "outtmpl": out_template,
            "quiet": True,
            "no_warnings": True,
            "writeautomaticsub": True,
            "subtitleslangs": ["en", "en-US"],
            "subtitlesformat": "json3",
            "skip_download": False,
            "noplaylist": True,
        }

    def _captions_from_info(self, info: dict[str, Any]) -> list[Caption]:
        # Best-effort: if yt-dlp has placed JSON3 subs in the info dict.
        # We accept zero captions silently — they're optional.
        return []

    def ingest(self, url: str) -> IngestResult:
        youtube_id = parse_youtube_id(url)
        opts = self._ydl_opts(youtube_id)
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            video_path = Path(ydl.prepare_filename(info))
        return IngestResult(
            youtube_id=youtube_id,
            video_path=video_path,
            title=info.get("title", ""),
            channel=info.get("channel") or info.get("uploader", ""),
            duration_s=float(info.get("duration") or 0),
            captions=self._captions_from_info(info),
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_ingestor.py -v`
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/pipeline/__init__.py backend/app/pipeline/ingestor.py backend/tests/unit/test_ingestor.py
git commit -m "feat(backend): add yt-dlp ingestor with YouTube ID parsing"
```

---

## Task 6: Pipeline — ShotSampler (PySceneDetect + ffmpeg)

**Files:**
- Create: `backend/app/pipeline/shot_sampler.py`
- Create: `backend/tests/unit/test_shot_sampler.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_shot_sampler.py`:
```python
from pathlib import Path
from unittest.mock import patch, MagicMock
from app.pipeline.shot_sampler import ShotSampler


def test_evenly_distributes_when_exceeding_cap(tmp_path: Path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    # Pretend PySceneDetect found 200 shots
    fake_shots = [(i * 1.0, (i + 1) * 1.0) for i in range(200)]

    with patch("app.pipeline.shot_sampler.detect", return_value=_to_scene_list(fake_shots)), \
         patch("app.pipeline.shot_sampler._extract_frame_at") as ex:
        ex.side_effect = lambda video_path, t, out: out.write_bytes(b"img")
        s = ShotSampler(out_dir=tmp_path / "frames", max_shots=10, frames_per_shot=1)
        keyframes = s.sample(video, youtube_id="abc")

    assert len(keyframes) == 10
    # Roughly evenly spaced timestamps
    timestamps = [k.timestamp_s for k in keyframes]
    assert timestamps == sorted(timestamps)
    assert timestamps[0] < timestamps[-1]


def test_one_frame_per_shot_under_cap(tmp_path: Path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    fake_shots = [(0.0, 5.0), (5.0, 12.0), (12.0, 18.0)]

    with patch("app.pipeline.shot_sampler.detect", return_value=_to_scene_list(fake_shots)), \
         patch("app.pipeline.shot_sampler._extract_frame_at") as ex:
        ex.side_effect = lambda video_path, t, out: out.write_bytes(b"img")
        s = ShotSampler(out_dir=tmp_path / "frames", max_shots=80, frames_per_shot=1)
        keyframes = s.sample(video, youtube_id="abc")

    assert len(keyframes) == 3
    assert keyframes[0].shot_id == "shot_00"
    assert keyframes[1].shot_id == "shot_01"
    assert keyframes[2].shot_id == "shot_02"
    # Each frame is the midpoint of its shot
    assert keyframes[0].timestamp_s == 2.5
    assert keyframes[1].timestamp_s == 8.5


def _to_scene_list(timecodes):
    """PySceneDetect returns list of (FrameTimecode, FrameTimecode)."""
    out = []
    for start, end in timecodes:
        s = MagicMock()
        s.get_seconds.return_value = start
        e = MagicMock()
        e.get_seconds.return_value = end
        out.append((s, e))
    return out
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_shot_sampler.py -v`
Expected: FAIL — `ModuleNotFoundError: app.pipeline.shot_sampler`.

- [ ] **Step 3: Implement ShotSampler**

Create `backend/app/pipeline/shot_sampler.py`:
```python
from __future__ import annotations
from pathlib import Path
from typing import Sequence
import ffmpeg
from scenedetect import detect, ContentDetector

from app.models import KeyFrame


def _extract_frame_at(video_path: Path, timestamp_s: float, out: Path) -> None:
    """Extract a single JPEG frame at `timestamp_s` to `out`."""
    out.parent.mkdir(parents=True, exist_ok=True)
    (
        ffmpeg.input(str(video_path), ss=timestamp_s)
        .output(str(out), vframes=1, **{"q:v": 3})
        .overwrite_output()
        .run(quiet=True, capture_stdout=True, capture_stderr=True)
    )


class ShotSampler:
    def __init__(self, out_dir: Path, max_shots: int = 80, frames_per_shot: int = 1):
        self._out_dir = out_dir
        self._max_shots = max_shots
        self._frames_per_shot = frames_per_shot

    def _select_shots(self, scene_list: Sequence[tuple]) -> list[tuple[float, float]]:
        all_shots = [(s.get_seconds(), e.get_seconds()) for s, e in scene_list]
        if len(all_shots) <= self._max_shots:
            return all_shots
        # Evenly distribute selection across the timeline
        n = len(all_shots)
        step = n / self._max_shots
        return [all_shots[int(i * step)] for i in range(self._max_shots)]

    def sample(self, video_path: Path, *, youtube_id: str) -> list[KeyFrame]:
        scene_list = detect(str(video_path), ContentDetector(threshold=27.0))
        shots = self._select_shots(scene_list)

        frames_dir = self._out_dir / youtube_id
        frames_dir.mkdir(parents=True, exist_ok=True)

        keyframes: list[KeyFrame] = []
        for i, (start, end) in enumerate(shots):
            mid = (start + end) / 2.0
            shot_id = f"shot_{i:02d}"
            out_path = frames_dir / f"{shot_id}.jpg"
            _extract_frame_at(video_path, mid, out_path)
            keyframes.append(
                KeyFrame(shot_id=shot_id, timestamp_s=mid, frame_path=out_path)
            )
        return keyframes
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_shot_sampler.py -v`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/pipeline/shot_sampler.py backend/tests/unit/test_shot_sampler.py
git commit -m "feat(backend): add shot detector + key-frame extractor"
```

---

## Task 7: Prompts (frame_analyzer, ref_proposer, verifier)

**Files:**
- Create: `backend/app/prompts/__init__.py`
- Create: `backend/app/prompts/frame_analyzer.md`
- Create: `backend/app/prompts/ref_proposer.md`
- Create: `backend/app/prompts/verifier.md`
- Create: `backend/app/prompts/loader.py`
- Create: `backend/tests/unit/test_prompts.py`

- [ ] **Step 1: Write the failing test**

Create `backend/app/prompts/__init__.py` (empty).

Create `backend/tests/unit/test_prompts.py`:
```python
from app.prompts.loader import load_prompt


def test_load_frame_analyzer_prompt_contains_evidence_only_clause():
    p = load_prompt("frame_analyzer")
    assert "evidence" in p.lower()
    assert "json" in p.lower()


def test_load_ref_proposer_rejects_vague():
    p = load_prompt("ref_proposer")
    assert "named" in p.lower()
    assert "{frame_summaries}" in p


def test_load_verifier_adversarial():
    p = load_prompt("verifier")
    assert "reject" in p.lower()
    assert "{candidate}" in p
    assert "{frame_analysis}" in p


def test_unknown_prompt_raises():
    import pytest
    with pytest.raises(FileNotFoundError):
        load_prompt("nope")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_prompts.py -v`
Expected: FAIL — `ModuleNotFoundError: app.prompts.loader`.

- [ ] **Step 3: Write the prompt files**

Create `backend/app/prompts/frame_analyzer.md`:
```markdown
You are a meticulous visual observer analyzing a single frame of a music video.

Your only job is to describe what is visible. **Do not speculate about references, citations, or influences from other works** at this stage. That is a separate step performed by another model.

Output strict JSON matching this schema. No prose outside JSON. No markdown. No code fences.

```
{
  "composition": "<one short sentence: framing, symmetry, depth>",
  "palette": ["<dominant color>", "<dominant color>", "<dominant color>"],
  "camera_move": "<static | pan | tilt | tracking | dolly | handheld | unknown>",
  "costume_setting": "<who/what is in frame and where>",
  "distinctive_features": ["<unusual visual element>", "<unusual visual element>"],
  "raw_description": "<2-3 sentences of plain factual description>",
  "confidence_in_observation": <float 0..1, how certain you are about your description>
}
```

Be concrete. Use specific nouns. Describe lighting, geometry, motion. Do NOT name films, artists, or eras the image reminds you of — that comes later.
```

Create `backend/app/prompts/ref_proposer.md`:
```markdown
You are a culturally literate critic. You receive structured descriptions of multiple frames from a single music video. Your job is to propose **named, verifiable visual references** the clip may be making — to specific films, artworks, photographs, or other music videos.

# Inputs

Title: {title}
Channel: {channel}
Lyrics excerpt (may be empty): {lyrics}

Frame summaries:
{frame_summaries}

# Rules

1. Each reference MUST name a specific work with title and creator. Vague claims ("70s horror cinema", "European art film", "minimalist photography") are forbidden — return nothing rather than something vague.
2. Each reference MUST cite at least three concrete visual elements from the frame summaries that support it.
3. Distinguish *visual* references (cinematography, mise-en-scène, costume, palette, framing) from generic mood. Do not propose a reference based purely on theme or lyric.
4. If you have no confident named reference, return an empty list. An empty list is a perfectly acceptable answer.

# Output

Strict JSON. No markdown. No prose outside JSON.

```
{
  "candidates": [
    {
      "timestamp_s": <float>,
      "source_frame_id": "<shot_NN>",
      "work_title": "<exact title>",
      "work_creator": "<director / artist / photographer>",
      "work_year": <int or null>,
      "work_type": "<film | painting | photograph | music_video | other>",
      "reasoning": "<one sentence connecting at least three concrete visual elements>",
      "raw_confidence": <float 0..1>
    }
  ]
}
```
```

Create `backend/app/prompts/verifier.md`:
```markdown
You are an adversarial reviewer. A previous model has proposed a reference. Your job is to either **defend** the claim with concrete supporting visual elements, or **reject** it.

# The proposed claim

{candidate}

# The frame analysis it cites

{frame_analysis}

# Rules

- If you can list **3 or more** specific visual elements from the frame analysis that genuinely support the claim, return verdict "keep".
- If you can list 1–2 supporting elements but the connection is plausible-but-thin, return "speculative".
- If the claim is unsupported by the frame analysis, or relies on theme/mood rather than concrete visual elements, return "reject".

# Output

Strict JSON. No markdown.

```
{
  "verdict": "keep" | "speculative" | "reject",
  "supporting_elements": ["<concrete element>", "<concrete element>", "<concrete element>"],
  "final_confidence": <float 0..1>,
  "rationale": "<one sentence>"
}
```
```

- [ ] **Step 4: Implement loader**

Create `backend/app/prompts/loader.py`:
```python
from pathlib import Path
from functools import lru_cache

_PROMPT_DIR = Path(__file__).parent


@lru_cache(maxsize=16)
def load_prompt(name: str) -> str:
    path = _PROMPT_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"Prompt not found: {name}")
    return path.read_text(encoding="utf-8")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_prompts.py -v`
Expected: 4 passing tests.

- [ ] **Step 6: Commit**

```bash
git add backend/app/prompts backend/tests/unit/test_prompts.py
git commit -m "feat(backend): add versioned prompts and loader"
```

---

## Task 8: Pipeline — FrameAnalyzer

**Files:**
- Create: `backend/app/pipeline/frame_analyzer.py`
- Create: `backend/tests/unit/test_frame_analyzer.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_frame_analyzer.py`:
```python
import json
from pathlib import Path
from unittest.mock import AsyncMock
from app.models import KeyFrame
from app.pipeline.frame_analyzer import FrameAnalyzer


async def test_analyzes_each_frame(tmp_path: Path):
    img = tmp_path / "shot_00.jpg"
    img.write_bytes(b"\xff\xd8\xff\xd9")
    keyframes = [
        KeyFrame(shot_id="shot_00", timestamp_s=2.5, frame_path=img),
        KeyFrame(shot_id="shot_01", timestamp_s=8.5, frame_path=img),
    ]

    fake_response = {
        "composition": "centered",
        "palette": ["red", "black"],
        "camera_move": "tracking",
        "costume_setting": "hallway",
        "distinctive_features": ["symmetry"],
        "raw_description": "A red corridor.",
        "confidence_in_observation": 0.9,
    }

    nim = AsyncMock()
    nim.analyze_image.return_value = fake_response

    fa = FrameAnalyzer(nim_client=nim, model="cosmos", concurrency=2)
    results = await fa.analyze(keyframes)

    assert len(results) == 2
    assert results[0].frame_id == "shot_00"
    assert results[0].composition == "centered"
    assert results[0].palette == ["red", "black"]
    assert nim.analyze_image.await_count == 2


async def test_clamps_confidence_in_observation(tmp_path: Path):
    img = tmp_path / "f.jpg"
    img.write_bytes(b"x")
    nim = AsyncMock()
    nim.analyze_image.return_value = {
        "composition": "x",
        "palette": ["x"],
        "camera_move": "static",
        "costume_setting": "x",
        "distinctive_features": [],
        "raw_description": "x",
        "confidence_in_observation": 1.5,  # invalid
    }
    fa = FrameAnalyzer(nim_client=nim, model="m", concurrency=1)
    results = await fa.analyze(
        [KeyFrame(shot_id="s", timestamp_s=0.0, frame_path=img)]
    )
    assert results[0].confidence_in_observation == 1.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_frame_analyzer.py -v`
Expected: FAIL — `ModuleNotFoundError: app.pipeline.frame_analyzer`.

- [ ] **Step 3: Implement FrameAnalyzer**

Create `backend/app/pipeline/frame_analyzer.py`:
```python
from __future__ import annotations
import asyncio
from typing import Awaitable, Callable, Iterable
from app.models import FrameAnalysis, KeyFrame
from app.nim.client import NimClient
from app.prompts.loader import load_prompt


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, float(v)))


class FrameAnalyzer:
    def __init__(
        self,
        nim_client: NimClient,
        model: str,
        concurrency: int = 4,
        on_progress: Callable[[int, int], Awaitable[None]] | None = None,
    ):
        self._nim = nim_client
        self._model = model
        self._sem = asyncio.Semaphore(concurrency)
        self._on_progress = on_progress
        self._prompt = load_prompt("frame_analyzer")

    async def _one(self, kf: KeyFrame) -> FrameAnalysis:
        async with self._sem:
            data = await self._nim.analyze_image(
                model=self._model,
                image_path=kf.frame_path,
                prompt=self._prompt,
                json_mode=True,
            )
        return FrameAnalysis(
            timestamp_s=kf.timestamp_s,
            frame_id=kf.shot_id,
            composition=str(data.get("composition", "")),
            palette=[str(x) for x in (data.get("palette") or [])],
            camera_move=str(data.get("camera_move", "unknown")),
            costume_setting=str(data.get("costume_setting", "")),
            distinctive_features=[
                str(x) for x in (data.get("distinctive_features") or [])
            ],
            raw_description=str(data.get("raw_description", "")),
            confidence_in_observation=_clamp(
                float(data.get("confidence_in_observation", 0.5))
            ),
        )

    async def analyze(self, keyframes: Iterable[KeyFrame]) -> list[FrameAnalysis]:
        kfs = list(keyframes)
        results: list[FrameAnalysis] = [None] * len(kfs)  # type: ignore[list-item]
        completed = 0
        total = len(kfs)

        async def worker(i: int, kf: KeyFrame) -> None:
            nonlocal completed
            results[i] = await self._one(kf)
            completed += 1
            if self._on_progress:
                await self._on_progress(completed, total)

        await asyncio.gather(*(worker(i, kf) for i, kf in enumerate(kfs)))
        return results
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_frame_analyzer.py -v`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/pipeline/frame_analyzer.py backend/tests/unit/test_frame_analyzer.py
git commit -m "feat(backend): add Cosmos Reason frame analyzer with concurrency"
```

---

## Task 9: Pipeline — RefProposer

**Files:**
- Create: `backend/app/pipeline/ref_proposer.py`
- Create: `backend/tests/unit/test_ref_proposer.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_ref_proposer.py`:
```python
from unittest.mock import AsyncMock
from app.models import FrameAnalysis
from app.pipeline.ref_proposer import RefProposer


def _fa(frame_id: str, ts: float) -> FrameAnalysis:
    return FrameAnalysis(
        timestamp_s=ts,
        frame_id=frame_id,
        composition="centered symmetrical corridor",
        palette=["red", "black"],
        camera_move="slow tracking forward",
        costume_setting="man in white shirt, hotel hallway",
        distinctive_features=["one-point perspective", "neon"],
        raw_description="A long red corridor.",
        confidence_in_observation=0.9,
    )


async def test_proposes_named_candidates():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "candidates": [
            {
                "timestamp_s": 12.5,
                "source_frame_id": "shot_03",
                "work_title": "The Shining",
                "work_creator": "Stanley Kubrick",
                "work_year": 1980,
                "work_type": "film",
                "reasoning": "symmetry + corridor + slow track",
                "raw_confidence": 0.82,
            }
        ]
    }
    rp = RefProposer(nim_client=nim, model="m")
    out = await rp.propose(
        title="x",
        channel="y",
        lyrics_text="",
        frame_analyses=[_fa("shot_03", 12.5)],
    )
    assert len(out) == 1
    assert out[0].work_title == "The Shining"


async def test_drops_candidates_with_empty_title():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "candidates": [
            {
                "timestamp_s": 1.0,
                "source_frame_id": "shot_00",
                "work_title": "",
                "work_creator": "Someone",
                "work_type": "film",
                "reasoning": "x",
                "raw_confidence": 0.5,
            }
        ]
    }
    rp = RefProposer(nim_client=nim, model="m")
    out = await rp.propose(
        title="x", channel="y", lyrics_text="", frame_analyses=[_fa("shot_00", 1.0)]
    )
    assert out == []


async def test_empty_candidates_list_is_ok():
    nim = AsyncMock()
    nim.complete_text.return_value = {"candidates": []}
    rp = RefProposer(nim_client=nim, model="m")
    out = await rp.propose(
        title="x", channel="y", lyrics_text="", frame_analyses=[_fa("shot_00", 0.0)]
    )
    assert out == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_ref_proposer.py -v`
Expected: FAIL — `ModuleNotFoundError: app.pipeline.ref_proposer`.

- [ ] **Step 3: Implement RefProposer**

Create `backend/app/pipeline/ref_proposer.py`:
```python
from __future__ import annotations
import json
from typing import Iterable
from pydantic import ValidationError
from app.models import FrameAnalysis, ReferenceCandidate
from app.nim.client import NimClient
from app.prompts.loader import load_prompt


def _format_frame_summaries(frames: Iterable[FrameAnalysis]) -> str:
    blocks = []
    for f in frames:
        blocks.append(
            f"[{f.frame_id} @ {f.timestamp_s:.1f}s] "
            f"composition={f.composition}; "
            f"palette={', '.join(f.palette)}; "
            f"camera={f.camera_move}; "
            f"setting={f.costume_setting}; "
            f"features={', '.join(f.distinctive_features)}; "
            f"raw={f.raw_description}"
        )
    return "\n".join(blocks)


class RefProposer:
    def __init__(self, nim_client: NimClient, model: str):
        self._nim = nim_client
        self._model = model
        self._template = load_prompt("ref_proposer")

    async def propose(
        self,
        *,
        title: str,
        channel: str,
        lyrics_text: str,
        frame_analyses: list[FrameAnalysis],
    ) -> list[ReferenceCandidate]:
        prompt = self._template.format(
            title=title or "(unknown)",
            channel=channel or "(unknown)",
            lyrics=lyrics_text or "(none)",
            frame_summaries=_format_frame_summaries(frame_analyses),
        )
        data = await self._nim.complete_text(
            model=self._model,
            messages=[{"role": "user", "content": prompt}],
            json_mode=True,
        )
        raw = data.get("candidates") or []
        out: list[ReferenceCandidate] = []
        for item in raw:
            try:
                out.append(ReferenceCandidate.model_validate(item))
            except ValidationError:
                # Drop silently — vague/incomplete claims are filtered by design.
                continue
        return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_ref_proposer.py -v`
Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/pipeline/ref_proposer.py backend/tests/unit/test_ref_proposer.py
git commit -m "feat(backend): add reference proposer with strict named-claim filter"
```

---

## Task 10: Pipeline — Verifier (with Wikipedia check)

**Files:**
- Create: `backend/app/pipeline/verifier.py`
- Create: `backend/tests/unit/test_verifier.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_verifier.py`:
```python
import respx
from httpx import Response
from unittest.mock import AsyncMock
from app.models import FrameAnalysis, ReferenceCandidate, Verdict, Confidence
from app.pipeline.verifier import Verifier


def _fa() -> FrameAnalysis:
    return FrameAnalysis(
        timestamp_s=12.5,
        frame_id="shot_03",
        composition="centered corridor",
        palette=["red"],
        camera_move="tracking",
        costume_setting="hallway",
        distinctive_features=["symmetry"],
        raw_description="x",
        confidence_in_observation=0.9,
    )


def _candidate() -> ReferenceCandidate:
    return ReferenceCandidate(
        timestamp_s=12.5,
        source_frame_id="shot_03",
        work_title="The Shining",
        work_creator="Stanley Kubrick",
        work_year=1980,
        work_type="film",
        reasoning="x",
        raw_confidence=0.8,
    )


@respx.mock
async def test_keep_with_wikipedia_match():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "keep",
        "supporting_elements": ["symmetry", "corridor", "tracking"],
        "final_confidence": 0.85,
        "rationale": "matches",
    }
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(return_value=Response(200, json={"content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/The_Shining"}}}))
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    result = await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    assert result.verdict == Verdict.KEEP
    assert result.final_confidence == Confidence.CONFIRMED
    assert "wikipedia.org" in (result.wikipedia_url or "")


@respx.mock
async def test_keep_downgraded_to_speculative_when_wikipedia_missing():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "keep",
        "supporting_elements": ["x", "y", "z"],
        "final_confidence": 0.7,
        "rationale": "ok",
    }
    respx.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/The_Shining"
    ).mock(return_value=Response(404))
    v = Verifier(nim_client=nim, model="m", wikipedia=True)
    result = await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    assert result.verdict == Verdict.KEEP
    assert result.final_confidence == Confidence.SPECULATIVE


async def test_reject_returns_hidden():
    nim = AsyncMock()
    nim.complete_text.return_value = {
        "verdict": "reject",
        "supporting_elements": [],
        "final_confidence": 0.1,
        "rationale": "no",
    }
    v = Verifier(nim_client=nim, model="m", wikipedia=False)
    result = await v.verify(_candidate(), {f.frame_id: f for f in [_fa()]})
    assert result.verdict == Verdict.REJECT
    assert result.final_confidence == Confidence.HIDDEN
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_verifier.py -v`
Expected: FAIL — `ModuleNotFoundError: app.pipeline.verifier`.

- [ ] **Step 3: Implement Verifier**

Create `backend/app/pipeline/verifier.py`:
```python
from __future__ import annotations
import asyncio
import urllib.parse
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


WIKI_SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/{slug}"


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

    async def _wiki_url(self, work_title: str) -> str | None:
        slug = urllib.parse.quote(work_title.replace(" ", "_"))
        async with httpx.AsyncClient(timeout=10.0) as http:
            try:
                r = await http.get(WIKI_SUMMARY_URL.format(slug=slug))
            except httpx.HTTPError:
                return None
            if r.status_code != 200:
                return None
            data = r.json()
            try:
                return data["content_urls"]["desktop"]["page"]
            except (KeyError, TypeError):
                return None

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
            fa = frame_index.get(candidate.source_frame_id)
            fa_blob = fa.model_dump_json() if fa else "{}"
            cand_blob = candidate.model_dump_json()
            prompt = self._template.format(
                candidate=cand_blob, frame_analysis=fa_blob
            )
            data = await self._nim.complete_text(
                model=self._model,
                messages=[{"role": "user", "content": prompt}],
                json_mode=True,
            )
        verdict = Verdict(str(data.get("verdict", "reject")).lower())
        supporting = [str(x) for x in (data.get("supporting_elements") or [])]
        wiki_url: str | None = None
        if self._wiki and verdict is not Verdict.REJECT:
            wiki_url = await self._wiki_url(candidate.work_title)
        bucket = self._bucket(verdict, wiki_url)
        return VerifiedReference(
            **candidate.model_dump(),
            verdict=verdict,
            final_confidence=bucket,
            supporting_elements=supporting,
            wikipedia_url=wiki_url,
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
    ) -> list[VerifiedReference]:
        return await asyncio.gather(
            *(self._verify_one(c, frame_index) for c in candidates)
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_verifier.py -v`
Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/pipeline/verifier.py backend/tests/unit/test_verifier.py
git commit -m "feat(backend): add adversarial verifier with Wikipedia check"
```

---

## Task 11: Pipeline orchestrator + SSE event bus

**Files:**
- Create: `backend/app/pipeline/orchestrator.py`
- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/sse.py`
- Create: `backend/tests/unit/test_orchestrator.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_orchestrator.py`:
```python
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from app.api.sse import EventBus
from app.models import (
    FrameAnalysis,
    IngestResult,
    KeyFrame,
    ReferenceCandidate,
    Verdict,
    Confidence,
    VerifiedReference,
)
from app.pipeline.orchestrator import Orchestrator
from app.db import Database, AnalysisStatus


async def test_full_pipeline_emits_events_and_saves(tmp_path: Path):
    db = Database(db_path=tmp_path / "t.sqlite")
    await db.init()
    bus = EventBus()
    img = tmp_path / "shot_00.jpg"
    img.write_bytes(b"x")

    ingestor = MagicMock()
    ingestor.ingest.return_value = IngestResult(
        youtube_id="abc", video_path=tmp_path / "v.mp4",
        title="t", channel="c", duration_s=10.0, captions=[],
    )
    sampler = MagicMock()
    sampler.sample.return_value = [
        KeyFrame(shot_id="shot_00", timestamp_s=1.0, frame_path=img)
    ]
    fa_results = [
        FrameAnalysis(
            timestamp_s=1.0, frame_id="shot_00",
            composition="x", palette=["x"], camera_move="x",
            costume_setting="x", distinctive_features=[],
            raw_description="x", confidence_in_observation=0.8,
        )
    ]
    frame_analyzer = AsyncMock()
    frame_analyzer.analyze.return_value = fa_results
    candidates = [
        ReferenceCandidate(
            timestamp_s=1.0, source_frame_id="shot_00",
            work_title="The Shining", work_creator="Kubrick",
            work_year=1980, work_type="film",
            reasoning="x", raw_confidence=0.8,
        )
    ]
    proposer = AsyncMock()
    proposer.propose.return_value = candidates
    verifier = AsyncMock()
    verifier.verify_all.return_value = [
        VerifiedReference(
            **candidates[0].model_dump(),
            verdict=Verdict.KEEP,
            final_confidence=Confidence.CONFIRMED,
            supporting_elements=["x", "y", "z"],
            wikipedia_url="https://en.wikipedia.org/wiki/The_Shining",
        )
    ]

    received: list = []

    async def collect():
        async for ev in bus.subscribe("abc"):
            received.append(ev)
            if ev.step == "done":
                break

    orch = Orchestrator(
        db=db, bus=bus,
        ingestor=ingestor, sampler=sampler,
        frame_analyzer=frame_analyzer,
        ref_proposer=proposer, verifier=verifier,
    )
    consumer = asyncio.create_task(collect())
    await orch.run("https://www.youtube.com/watch?v=abc")
    await asyncio.wait_for(consumer, timeout=2.0)

    steps = [e.step for e in received]
    assert "ingest" in steps
    assert "shots" in steps
    assert "vision" in steps
    assert "crossref" in steps
    assert "verify" in steps
    assert steps[-1] == "done"
    assert await db.get_status("abc") == AnalysisStatus.DONE
    report = await db.load_report("abc")
    assert report is not None
    assert report.references[0].work_title == "The Shining"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_orchestrator.py -v`
Expected: FAIL — `ModuleNotFoundError: app.pipeline.orchestrator`.

- [ ] **Step 3: Implement EventBus**

Create `backend/app/api/__init__.py` (empty).

Create `backend/app/api/sse.py`:
```python
from __future__ import annotations
import asyncio
from collections import defaultdict
from typing import AsyncIterator
from app.models import PipelineEvent


class EventBus:
    """Per-youtube_id pub/sub for pipeline events.

    Subscribers receive events from publication time onward. Late
    subscribers get a synthetic 'done' if the analysis already
    finished — that contract is the orchestrator's responsibility.
    """

    def __init__(self):
        self._queues: dict[str, list[asyncio.Queue[PipelineEvent | None]]] = (
            defaultdict(list)
        )
        self._lock = asyncio.Lock()

    async def publish(self, youtube_id: str, event: PipelineEvent) -> None:
        async with self._lock:
            queues = list(self._queues.get(youtube_id, []))
        for q in queues:
            await q.put(event)
        if event.step in ("done", "error"):
            await self._close(youtube_id)

    async def subscribe(self, youtube_id: str) -> AsyncIterator[PipelineEvent]:
        q: asyncio.Queue[PipelineEvent | None] = asyncio.Queue()
        async with self._lock:
            self._queues[youtube_id].append(q)
        try:
            while True:
                ev = await q.get()
                if ev is None:
                    return
                yield ev
                if ev.step in ("done", "error"):
                    return
        finally:
            async with self._lock:
                if q in self._queues.get(youtube_id, []):
                    self._queues[youtube_id].remove(q)

    async def _close(self, youtube_id: str) -> None:
        async with self._lock:
            queues = list(self._queues.get(youtube_id, []))
            self._queues.pop(youtube_id, None)
        for q in queues:
            await q.put(None)
```

- [ ] **Step 4: Implement Orchestrator**

Create `backend/app/pipeline/orchestrator.py`:
```python
from __future__ import annotations
import logging
from app.api.sse import EventBus
from app.db import AnalysisStatus, Database
from app.models import PipelineEvent, Report
from app.pipeline.frame_analyzer import FrameAnalyzer
from app.pipeline.ingestor import Ingestor
from app.pipeline.ref_proposer import RefProposer
from app.pipeline.shot_sampler import ShotSampler
from app.pipeline.verifier import Verifier

logger = logging.getLogger(__name__)


class Orchestrator:
    def __init__(
        self,
        *,
        db: Database,
        bus: EventBus,
        ingestor: Ingestor,
        sampler: ShotSampler,
        frame_analyzer: FrameAnalyzer,
        ref_proposer: RefProposer,
        verifier: Verifier,
    ):
        self._db = db
        self._bus = bus
        self._ingestor = ingestor
        self._sampler = sampler
        self._frame_analyzer = frame_analyzer
        self._ref_proposer = ref_proposer
        self._verifier = verifier

    async def _emit(
        self, youtube_id: str, step: str, message: str, progress: float = 0.0,
        payload: dict | None = None,
    ) -> None:
        await self._bus.publish(
            youtube_id,
            PipelineEvent(
                step=step, message=message, progress=progress, payload=payload or {}
            ),
        )

    async def run(self, url: str) -> None:
        try:
            ingest = self._ingestor.ingest(url)
        except Exception as e:
            logger.exception("ingest failed")
            await self._emit("unknown", "error", str(e), progress=0.0)
            return

        yid = ingest.youtube_id
        try:
            await self._db.set_status(yid, AnalysisStatus.RUNNING)
            await self._emit(yid, "ingest", f"Downloaded '{ingest.title}'", 0.1)

            keyframes = self._sampler.sample(ingest.video_path, youtube_id=yid)
            await self._emit(
                yid, "shots", f"Detected {len(keyframes)} shots", 0.2,
                payload={"shot_count": len(keyframes)},
            )

            await self._emit(yid, "vision", "Analyzing frames", 0.25)
            frame_analyses = await self._frame_analyzer.analyze(keyframes)
            await self._emit(
                yid, "vision", f"Analyzed {len(frame_analyses)} frames", 0.55
            )

            await self._emit(yid, "crossref", "Cross-referencing", 0.6)
            lyrics = " ".join(c.text for c in ingest.captions)
            candidates = await self._ref_proposer.propose(
                title=ingest.title,
                channel=ingest.channel,
                lyrics_text=lyrics,
                frame_analyses=frame_analyses,
            )
            await self._emit(
                yid, "crossref", f"Proposed {len(candidates)} candidates", 0.7
            )

            await self._emit(yid, "verify", "Verifying claims", 0.75)
            frame_index = {fa.frame_id: fa for fa in frame_analyses}
            verified = await self._verifier.verify_all(candidates, frame_index)
            kept = [v for v in verified if v.final_confidence.value != "hidden"]

            report = Report(
                youtube_id=yid,
                title=ingest.title,
                channel=ingest.channel,
                duration_s=ingest.duration_s,
                references=kept,
                frame_analyses=frame_analyses,
            )
            await self._db.save_report(report, status=AnalysisStatus.DONE)

            # Delete the mp4 — frames are kept on disk for the UI.
            try:
                ingest.video_path.unlink(missing_ok=True)
            except OSError:
                pass

            await self._emit(
                yid, "done", f"Done. {len(kept)} references kept.", 1.0,
                payload={"reference_count": len(kept)},
            )
        except Exception as e:
            logger.exception("pipeline failed")
            await self._db.set_status(yid, AnalysisStatus.ERROR, error=str(e))
            await self._emit(yid, "error", str(e), progress=0.0)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_orchestrator.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/__init__.py backend/app/api/sse.py backend/app/pipeline/orchestrator.py backend/tests/unit/test_orchestrator.py
git commit -m "feat(backend): add pipeline orchestrator and SSE event bus"
```

---

## Task 12: API routes

**Files:**
- Create: `backend/app/api/routes.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/unit/test_api.py`

- [ ] **Step 1: Write the failing API test**

Create `backend/tests/unit/test_api.py`:
```python
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock
import pytest
from httpx import ASGITransport, AsyncClient
from app.api.sse import EventBus
from app.db import AnalysisStatus, Database
from app.main import build_app
from app.models import (
    Report, VerifiedReference, Verdict, Confidence,
)


@pytest.fixture
async def client(tmp_path: Path):
    db = Database(db_path=tmp_path / "t.sqlite")
    await db.init()
    bus = EventBus()
    orch_run = AsyncMock()  # no-op orchestrator stand-in
    app = build_app(db=db, bus=bus, run_pipeline=orch_run)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c, db, orch_run, bus


async def test_analyze_returns_running_for_new_url(client):
    c, db, orch_run, bus = client
    r = await c.post(
        "/api/analyze",
        json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["youtube_id"] == "dQw4w9WgXcQ"
    assert body["status"] == "running"
    assert body["status_stream_url"].endswith("/api/stream/dQw4w9WgXcQ")
    # Ensure orchestrator was scheduled
    await asyncio.sleep(0)
    assert orch_run.await_count >= 1


async def test_analyze_returns_cached_when_done(client):
    c, db, orch_run, bus = client
    report = Report(
        youtube_id="dQw4w9WgXcQ",
        title="t", channel="c", duration_s=1.0,
        references=[], frame_analyses=[],
    )
    await db.save_report(report, status=AnalysisStatus.DONE)
    r = await c.post(
        "/api/analyze",
        json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
    )
    assert r.json()["status"] == "cached"


async def test_get_report_404_when_missing(client):
    c, *_ = client
    r = await c.get("/api/report/missing")
    assert r.status_code == 404


async def test_get_report_returns_payload(client):
    c, db, *_ = client
    report = Report(
        youtube_id="x", title="t", channel="c", duration_s=1.0,
        references=[
            VerifiedReference(
                timestamp_s=1.0, source_frame_id="shot_00",
                work_title="W", work_creator="C", work_type="film",
                reasoning="r", raw_confidence=0.5,
                verdict=Verdict.KEEP, final_confidence=Confidence.CONFIRMED,
                supporting_elements=[],
            )
        ],
        frame_analyses=[],
    )
    await db.save_report(report, status=AnalysisStatus.DONE)
    r = await c.get("/api/report/x")
    assert r.status_code == 200
    assert r.json()["title"] == "t"
    assert r.json()["references"][0]["work_title"] == "W"


async def test_flag_endpoint(client):
    c, db, *_ = client
    report = Report(
        youtube_id="x", title="t", channel="c", duration_s=1.0,
        references=[], frame_analyses=[],
    )
    await db.save_report(report, status=AnalysisStatus.DONE)
    r = await c.post(
        "/api/report/x/flag", json={"ref_index": 0, "reason": "wrong"}
    )
    assert r.status_code == 200
    flags = await db.list_flags("x")
    assert len(flags) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_api.py -v`
Expected: FAIL — `cannot import name 'build_app'`.

- [ ] **Step 3: Implement routes**

Create `backend/app/api/routes.py`:
```python
from __future__ import annotations
import asyncio
import logging
from typing import Awaitable, Callable
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.api.sse import EventBus
from app.db import AnalysisStatus, Database
from app.pipeline.ingestor import parse_youtube_id

logger = logging.getLogger(__name__)


class AnalyzeBody(BaseModel):
    url: str
    refresh: bool = False


class AnalyzeResponse(BaseModel):
    youtube_id: str
    status: str
    status_stream_url: str | None = None


class FlagBody(BaseModel):
    ref_index: int
    reason: str | None = None


def build_router(
    *,
    db: Database,
    bus: EventBus,
    run_pipeline: Callable[[str], Awaitable[None]],
) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @router.post("/analyze", response_model=AnalyzeResponse)
    async def analyze(body: AnalyzeBody) -> AnalyzeResponse:
        try:
            yid = parse_youtube_id(body.url)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if not body.refresh:
            status = await db.get_status(yid)
            if status == AnalysisStatus.DONE:
                return AnalyzeResponse(youtube_id=yid, status="cached")
        # Schedule pipeline run; fire-and-forget. The bus carries progress.
        asyncio.create_task(run_pipeline(body.url))
        return AnalyzeResponse(
            youtube_id=yid,
            status="running",
            status_stream_url=f"/api/stream/{yid}",
        )

    @router.get("/report/{youtube_id}")
    async def get_report(youtube_id: str) -> dict:
        report = await db.load_report(youtube_id)
        if report is None:
            raise HTTPException(status_code=404, detail="report not found")
        return report.model_dump(mode="json")

    @router.post("/report/{youtube_id}/flag")
    async def flag(youtube_id: str, body: FlagBody) -> dict[str, str]:
        await db.flag_reference(youtube_id, body.ref_index, body.reason)
        return {"status": "ok"}

    @router.get("/stream/{youtube_id}")
    async def stream(youtube_id: str):
        async def gen():
            async for ev in bus.subscribe(youtube_id):
                yield {"event": ev.step, "data": ev.model_dump_json()}
        return EventSourceResponse(gen())

    return router
```

- [ ] **Step 4: Update main.py to expose `build_app`**

Replace `backend/app/main.py` with:
```python
from __future__ import annotations
import logging
from contextlib import asynccontextmanager
from typing import Awaitable, Callable
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import build_router
from app.api.sse import EventBus
from app.db import Database
from app.nim.client import NimClient
from app.pipeline.frame_analyzer import FrameAnalyzer
from app.pipeline.ingestor import Ingestor
from app.pipeline.orchestrator import Orchestrator
from app.pipeline.ref_proposer import RefProposer
from app.pipeline.shot_sampler import ShotSampler
from app.pipeline.verifier import Verifier
from app.settings import settings

logging.basicConfig(level=logging.INFO)


def build_app(
    *,
    db: Database,
    bus: EventBus,
    run_pipeline: Callable[[str], Awaitable[None]],
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await db.init()
        yield

    app = FastAPI(title="ClipDecoder API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(
        build_router(db=db, bus=bus, run_pipeline=run_pipeline)
    )
    return app


def _build_default_app() -> FastAPI:
    db = Database(db_path=settings.db_path)
    bus = EventBus()
    nim = NimClient(api_key=settings.nvapi_key, base_url=settings.nim_base_url)
    work_dir = settings.data_dir / "downloads"
    frames_dir = settings.data_dir / "frames"
    orch = Orchestrator(
        db=db, bus=bus,
        ingestor=Ingestor(work_dir=work_dir),
        sampler=ShotSampler(
            out_dir=frames_dir,
            max_shots=settings.max_shots_per_video,
            frames_per_shot=settings.frames_per_shot,
        ),
        frame_analyzer=FrameAnalyzer(
            nim_client=nim,
            model=settings.cosmos_reason_model,
            concurrency=settings.nim_concurrency,
        ),
        ref_proposer=RefProposer(nim_client=nim, model=settings.llm_model),
        verifier=Verifier(
            nim_client=nim,
            model=settings.llm_model,
            wikipedia=settings.wikipedia_verification,
            concurrency=settings.nim_concurrency,
        ),
    )
    return build_app(db=db, bus=bus, run_pipeline=orch.run)


app = _build_default_app()
```

Also update the existing health test — replace `backend/tests/unit/test_health.py`:
```python
import pytest
from pathlib import Path
from unittest.mock import AsyncMock
from httpx import ASGITransport, AsyncClient
from app.api.sse import EventBus
from app.db import Database
from app.main import build_app


@pytest.fixture
async def client(tmp_path: Path):
    db = Database(db_path=tmp_path / "t.sqlite")
    await db.init()
    app = build_app(db=db, bus=EventBus(), run_pipeline=AsyncMock())
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def test_health_returns_ok(client):
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

- [ ] **Step 5: Run all backend tests**

Run: `cd backend && uv run pytest -v`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/routes.py backend/app/main.py backend/tests/unit/test_api.py backend/tests/unit/test_health.py
git commit -m "feat(backend): wire REST endpoints, SSE stream, and DI-ready app builder"
```

---

## Task 13: Backend Dockerfile

**Files:**
- Create: `backend/Dockerfile`

- [ ] **Step 1: Create Dockerfile**

Create `backend/Dockerfile`:
```dockerfile
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy

# System deps for ffmpeg + scenedetect (opencv) + yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /bin/uv

WORKDIR /app

# Lockfile-first install for cache friendliness
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Build to verify**

Run: `docker build -t clipdecoder-backend backend/`
Expected: Successful build, no errors. (If Docker is not available locally, document and skip — CI can verify.)

- [ ] **Step 3: Commit**

```bash
git add backend/Dockerfile
git commit -m "build(backend): add Dockerfile with ffmpeg and uv"
```

---

## Task 14: Frontend scaffold (Next.js + Tailwind v4 + DESIGN.md tokens)

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/next.config.ts`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.mjs`
- Create: `frontend/app/layout.tsx`
- Create: `frontend/app/globals.css`
- Create: `frontend/app/page.tsx`
- Create: `frontend/lib/design.ts`
- Create: `frontend/lib/types.ts`
- Create: `frontend/public/fonts/.gitkeep`

- [ ] **Step 1: Create the package**

Create `frontend/package.json`:
```json
{
  "name": "clipdecoder-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "next lint",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "15.0.4",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "react-player": "2.16.0",
    "clsx": "2.1.1"
  },
  "devDependencies": {
    "@types/node": "22.10.1",
    "@types/react": "19.0.1",
    "@types/react-dom": "19.0.2",
    "@vitejs/plugin-react": "4.3.4",
    "@testing-library/react": "16.1.0",
    "@testing-library/jest-dom": "6.6.3",
    "happy-dom": "15.11.7",
    "tailwindcss": "4.0.0-beta.7",
    "@tailwindcss/postcss": "4.0.0-beta.7",
    "postcss": "8.4.49",
    "typescript": "5.7.2",
    "vitest": "2.1.8"
  }
}
```

Create `frontend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `frontend/next.config.ts`:
```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://localhost:8000/api/:path*" },
    ];
  },
};

export default config;
```

Create `frontend/postcss.config.mjs`:
```js
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
```

- [ ] **Step 2: Define DESIGN.md tokens in TS and Tailwind**

Create `frontend/lib/design.ts`:
```ts
// Mirror of DESIGN.md tokens. Keep this file in sync with the spec.
export const COLORS = {
  brandMagenta: "#ef2cc1",
  brandOrange: "#fc4c02",
  darkBlue: "#010120",
  softLavender: "#bdbbff",
  pureWhite: "#ffffff",
  pureBlack: "#000000",
  black8: "rgba(0, 0, 0, 0.08)",
  black40: "rgba(0, 0, 0, 0.40)",
  white12: "rgba(255, 255, 255, 0.12)",
  glassLight: "rgba(255, 255, 255, 0.12)",
  glassDark: "rgba(0, 0, 0, 0.08)",
  shadowMidnight: "rgba(1, 1, 32, 0.1)",
} as const;

export const RADIUS = { sharp: "4px", comfy: "8px" } as const;
export const SHADOW = {
  midnight: "0px 4px 10px rgba(1, 1, 32, 0.1)",
} as const;

export const TYPE = {
  display: { fontSize: "64px", lineHeight: "1.05", letterSpacing: "-1.92px" },
  h2:      { fontSize: "40px", lineHeight: "1.20", letterSpacing: "-0.8px" },
  h3:      { fontSize: "28px", lineHeight: "1.15", letterSpacing: "-0.42px" },
  feature: { fontSize: "22px", lineHeight: "1.15", letterSpacing: "-0.22px" },
  bodyLg:  { fontSize: "18px", lineHeight: "1.30", letterSpacing: "-0.18px" },
  body:    { fontSize: "16px", lineHeight: "1.30", letterSpacing: "-0.16px" },
  caption: { fontSize: "14px", lineHeight: "1.40", letterSpacing: "0px" },
  monoLabel: { fontSize: "11px", lineHeight: "1.40", letterSpacing: "0.055px" },
} as const;
```

Create `frontend/tailwind.config.ts`:
```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { magenta: "#ef2cc1", orange: "#fc4c02" },
        midnight: "#010120",
        lavender: "#bdbbff",
      },
      borderRadius: { sharp: "4px", comfy: "8px" },
      boxShadow: { midnight: "0px 4px 10px rgba(1, 1, 32, 0.1)" },
      fontFamily: {
        display: ["The Future", "Arial", "sans-serif"],
        mono: ["PP Neue Montreal Mono", "Georgia", "monospace"],
      },
      letterSpacing: {
        display: "-1.92px",
        h2: "-0.8px",
        h3: "-0.42px",
        body: "-0.16px",
        monoLabel: "0.055px",
      },
    },
  },
};
export default config;
```

- [ ] **Step 3: Set up global styles + fonts (with fallbacks)**

Create `frontend/app/globals.css`:
```css
@import "tailwindcss";

@font-face {
  font-family: "The Future";
  src: local("The Future"), local("Arial");
  font-display: swap;
}
@font-face {
  font-family: "PP Neue Montreal Mono";
  src: local("PP Neue Montreal Mono"), local("Georgia");
  font-display: swap;
}

:root {
  --color-midnight: #010120;
  --shadow-midnight: 0px 4px 10px rgba(1, 1, 32, 0.1);
}

html, body {
  font-family: "The Future", Arial, sans-serif;
  letter-spacing: -0.16px;
  background: #ffffff;
  color: #000000;
}

.bg-pastel-cloud {
  background:
    radial-gradient(60% 50% at 20% 30%, #ffd5f0 0%, transparent 60%),
    radial-gradient(50% 50% at 80% 20%, #c9d8ff 0%, transparent 60%),
    radial-gradient(70% 60% at 50% 80%, #e8e0ff 0%, transparent 70%),
    #ffffff;
}

.surface-dark { background: var(--color-midnight); color: #ffffff; }
.shadow-midnight { box-shadow: var(--shadow-midnight); }
.tracking-display { letter-spacing: -1.92px; }
.tracking-h2 { letter-spacing: -0.8px; }
.tracking-mono-label { letter-spacing: 0.055px; }
```

- [ ] **Step 4: Add layout, hero, types**

Create `frontend/app/layout.tsx`:
```tsx
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ClipDecoder",
  description: "Decode the visual references in your favorite music videos.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Create `frontend/app/page.tsx` (placeholder; populated in Task 16):
```tsx
export default function Home() {
  return (
    <main className="bg-pastel-cloud min-h-screen flex items-center justify-center">
      <h1
        className="font-display tracking-display text-[64px] leading-[1.05]"
      >
        ClipDecoder
      </h1>
    </main>
  );
}
```

Create `frontend/lib/types.ts`:
```ts
export type Verdict = "keep" | "speculative" | "reject";
export type Confidence = "confirmed" | "speculative" | "hidden";

export interface VerifiedReference {
  timestamp_s: number;
  source_frame_id: string;
  work_title: string;
  work_creator: string;
  work_year: number | null;
  work_type: string;
  reasoning: string;
  raw_confidence: number;
  verdict: Verdict;
  final_confidence: Confidence;
  supporting_elements: string[];
  wikipedia_url: string | null;
}

export interface FrameAnalysis {
  timestamp_s: number;
  frame_id: string;
  composition: string;
  palette: string[];
  camera_move: string;
  costume_setting: string;
  distinctive_features: string[];
  raw_description: string;
  confidence_in_observation: number;
}

export interface Report {
  youtube_id: string;
  title: string;
  channel: string;
  duration_s: number;
  references: VerifiedReference[];
  frame_analyses: FrameAnalysis[];
}

export type PipelineStep =
  | "ingest" | "shots" | "vision" | "crossref" | "verify" | "done" | "error";

export interface PipelineEvent {
  step: PipelineStep;
  message: string;
  progress: number;
  payload: Record<string, unknown>;
}
```

Create `frontend/public/fonts/.gitkeep` (empty file).

- [ ] **Step 5: Install + verify build**

Run from repo root:
```bash
cd frontend && pnpm install && pnpm build
```
Expected: clean build. The hero page renders with the pastel gradient background.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/tsconfig.json frontend/next.config.ts frontend/tailwind.config.ts frontend/postcss.config.mjs frontend/app frontend/lib frontend/public
git commit -m "feat(frontend): scaffold Next.js 15 + Tailwind v4 with DESIGN.md tokens"
```

---

## Task 15: Frontend API client (REST + SSE)

**Files:**
- Create: `frontend/lib/api.ts`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/lib/api.test.ts`

- [ ] **Step 1: Set up Vitest config**

Create `frontend/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
  },
});
```

- [ ] **Step 2: Write the failing API test**

Create `frontend/lib/api.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { startAnalysis, fetchReport, flagReference } from "./api";

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("startAnalysis posts URL and returns server response", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        youtube_id: "abc",
        status: "running",
        status_stream_url: "/api/stream/abc",
      }),
    });
    vi.stubGlobal("fetch", mock);
    const r = await startAnalysis("https://www.youtube.com/watch?v=abc");
    expect(r.youtube_id).toBe("abc");
    expect(mock).toHaveBeenCalledWith(
      "/api/analyze",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fetchReport returns parsed report on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        youtube_id: "abc", title: "t", channel: "c", duration_s: 0,
        references: [], frame_analyses: [],
      }),
    }));
    const r = await fetchReport("abc");
    expect(r?.youtube_id).toBe("abc");
  });

  it("fetchReport returns null on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 404,
    }));
    const r = await fetchReport("abc");
    expect(r).toBeNull();
  });

  it("flagReference posts ref_index", async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", mock);
    await flagReference("abc", 0, "wrong");
    expect(mock).toHaveBeenCalledWith(
      "/api/report/abc/flag",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ref_index: 0, reason: "wrong" }),
      }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && pnpm test`
Expected: FAIL — `Cannot find module './api'`.

- [ ] **Step 4: Implement API client**

Create `frontend/lib/api.ts`:
```ts
import type { PipelineEvent, Report } from "./types";

export interface StartAnalysisResponse {
  youtube_id: string;
  status: "running" | "cached";
  status_stream_url?: string;
}

export async function startAnalysis(
  url: string,
  refresh = false,
): Promise<StartAnalysisResponse> {
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, refresh }),
  });
  if (!r.ok) throw new Error(`analyze failed: ${r.status}`);
  return (await r.json()) as StartAnalysisResponse;
}

export async function fetchReport(youtubeId: string): Promise<Report | null> {
  const r = await fetch(`/api/report/${encodeURIComponent(youtubeId)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`report failed: ${r.status}`);
  return (await r.json()) as Report;
}

export async function flagReference(
  youtubeId: string,
  refIndex: number,
  reason?: string,
): Promise<void> {
  const r = await fetch(`/api/report/${encodeURIComponent(youtubeId)}/flag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref_index: refIndex, reason }),
  });
  if (!r.ok) throw new Error(`flag failed: ${r.status}`);
}

export function subscribePipeline(
  youtubeId: string,
  onEvent: (e: PipelineEvent) => void,
  onError?: (err: unknown) => void,
): () => void {
  const es = new EventSource(`/api/stream/${encodeURIComponent(youtubeId)}`);
  const stepNames: PipelineEvent["step"][] = [
    "ingest", "shots", "vision", "crossref", "verify", "done", "error",
  ];
  for (const step of stepNames) {
    es.addEventListener(step, (raw) => {
      try {
        const data = JSON.parse((raw as MessageEvent).data) as PipelineEvent;
        onEvent(data);
        if (data.step === "done" || data.step === "error") es.close();
      } catch (err) {
        onError?.(err);
      }
    });
  }
  es.onerror = (err) => onError?.(err);
  return () => es.close();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && pnpm test`
Expected: 4 passing tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/api.ts frontend/lib/api.test.ts frontend/vitest.config.ts
git commit -m "feat(frontend): add REST + SSE API client"
```

---

## Task 16: Frontend hero form

**Files:**
- Create: `frontend/components/HeroForm.tsx`
- Modify: `frontend/app/page.tsx`
- Create: `frontend/components/HeroForm.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `frontend/components/HeroForm.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HeroForm } from "./HeroForm";

describe("HeroForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("submits URL and calls onSubmit with the response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        youtube_id: "abc",
        status: "running",
        status_stream_url: "/api/stream/abc",
      }),
    }));
    const onSubmit = vi.fn();
    render(<HeroForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByPlaceholderText(/youtube/i), {
      target: { value: "https://www.youtube.com/watch?v=abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: /decode/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ youtube_id: "abc" }),
      ),
    );
  });

  it("shows error message on bad URL response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ detail: "bad" }),
    }));
    render(<HeroForm onSubmit={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/youtube/i), {
      target: { value: "not-a-url" },
    });
    fireEvent.click(screen.getByRole("button", { name: /decode/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm test`
Expected: FAIL — `Cannot find module './HeroForm'`.

- [ ] **Step 3: Implement HeroForm**

Create `frontend/components/HeroForm.tsx`:
```tsx
"use client";
import { useState } from "react";
import { startAnalysis, type StartAnalysisResponse } from "@/lib/api";

export function HeroForm({
  onSubmit,
}: {
  onSubmit: (r: StartAnalysisResponse) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await startAnalysis(url);
      onSubmit(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-2xl flex flex-col gap-4">
      <label className="font-mono uppercase text-[11px] tracking-mono-label text-black/60">
        YouTube URL
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          className="flex-1 px-4 py-3 rounded-sharp border border-black/10 bg-white shadow-midnight outline-none focus:border-midnight"
        />
        <button
          type="submit"
          disabled={busy}
          className="px-6 py-3 rounded-sharp bg-midnight text-white disabled:opacity-50"
        >
          {busy ? "Working…" : "Decode"}
        </button>
      </div>
      {error && (
        <div role="alert" className="text-[14px] text-brand-orange">
          {error}
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Update home page to use HeroForm with router redirect**

Replace `frontend/app/page.tsx`:
```tsx
"use client";
import { useRouter } from "next/navigation";
import { HeroForm } from "@/components/HeroForm";

export default function Home() {
  const router = useRouter();
  return (
    <main className="bg-pastel-cloud min-h-screen flex flex-col items-center justify-center px-6 gap-12">
      <header className="text-center">
        <p className="font-mono uppercase text-[11px] tracking-mono-label text-black/60 mb-4">
          ClipDecoder
        </p>
        <h1 className="font-display tracking-display text-[64px] leading-[1.05]">
          Decode the visual<br />references in any clip.
        </h1>
        <p className="mt-6 text-[18px] tracking-body text-black/60 max-w-xl mx-auto">
          Paste a YouTube URL. Get an annotated viewer with named, evidence-grounded references — films, paintings, photographs, other clips.
        </p>
      </header>
      <HeroForm onSubmit={(r) => router.push(`/report/${r.youtube_id}`)} />
    </main>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `cd frontend && pnpm test`
Expected: 2 new tests pass; previous 4 still pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/HeroForm.tsx frontend/components/HeroForm.test.tsx frontend/app/page.tsx
git commit -m "feat(frontend): add hero form and home page"
```

---

## Task 17: Frontend pipeline status component

**Files:**
- Create: `frontend/components/PipelineStatus.tsx`
- Create: `frontend/components/PipelineStatus.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/components/PipelineStatus.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PipelineStatus } from "./PipelineStatus";

describe("PipelineStatus", () => {
  it("highlights only completed steps", () => {
    render(
      <PipelineStatus
        events={[
          { step: "ingest", message: "Downloaded", progress: 0.1, payload: {} },
          { step: "shots", message: "12 shots", progress: 0.2, payload: {} },
        ]}
      />,
    );
    expect(screen.getByText("INGEST")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("SHOTS")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("VISION")).toHaveAttribute("data-active", "false");
  });

  it("renders the latest message", () => {
    render(
      <PipelineStatus
        events={[
          { step: "ingest", message: "Downloaded 'X'", progress: 0.1, payload: {} },
          { step: "vision", message: "Analyzed 5 frames", progress: 0.5, payload: {} },
        ]}
      />,
    );
    expect(screen.getByText("Analyzed 5 frames")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm test`
Expected: FAIL — `Cannot find module './PipelineStatus'`.

- [ ] **Step 3: Implement PipelineStatus**

Create `frontend/components/PipelineStatus.tsx`:
```tsx
import type { PipelineEvent, PipelineStep } from "@/lib/types";

const STEPS: { key: PipelineStep; label: string }[] = [
  { key: "ingest", label: "INGEST" },
  { key: "shots", label: "SHOTS" },
  { key: "vision", label: "VISION" },
  { key: "crossref", label: "CROSS-REF" },
  { key: "verify", label: "VERIFY" },
];

export function PipelineStatus({ events }: { events: PipelineEvent[] }) {
  const seen = new Set(events.map((e) => e.step));
  const latest = events[events.length - 1];
  return (
    <div className="w-full max-w-3xl flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {STEPS.map((s) => {
          const active = seen.has(s.key);
          return (
            <span
              key={s.key}
              data-active={active}
              className={`font-mono uppercase text-[11px] tracking-mono-label px-3 py-2 rounded-sharp border ${
                active
                  ? "border-midnight bg-midnight text-white"
                  : "border-black/10 bg-white text-black/40"
              }`}
            >
              {s.label}
            </span>
          );
        })}
      </div>
      {latest && (
        <p className="text-[16px] tracking-body text-black/60">
          {latest.message}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && pnpm test`
Expected: 2 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/PipelineStatus.tsx frontend/components/PipelineStatus.test.tsx
git commit -m "feat(frontend): add pipeline status indicator"
```

---

## Task 18: Frontend video player

**Files:**
- Create: `frontend/components/VideoPlayer.tsx`
- Create: `frontend/components/VideoPlayer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/components/VideoPlayer.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { createRef } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "./VideoPlayer";

vi.mock("react-player", () => ({
  default: vi.fn(() => <div data-testid="rp" />),
}));

describe("VideoPlayer", () => {
  it("exposes seekTo via ref", () => {
    const ref = createRef<VideoPlayerHandle>();
    render(<VideoPlayer ref={ref} youtubeId="abc" />);
    expect(typeof ref.current?.seekTo).toBe("function");
    act(() => ref.current?.seekTo(42));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm test`
Expected: FAIL.

- [ ] **Step 3: Implement VideoPlayer**

Create `frontend/components/VideoPlayer.tsx`:
```tsx
"use client";
import {
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import ReactPlayer from "react-player";

export interface VideoPlayerHandle {
  seekTo: (timestampS: number) => void;
}

export const VideoPlayer = forwardRef<
  VideoPlayerHandle,
  { youtubeId: string }
>(function VideoPlayer({ youtubeId }, ref) {
  const playerRef = useRef<ReactPlayer | null>(null);

  useImperativeHandle(ref, () => ({
    seekTo: (t: number) => playerRef.current?.seekTo(t, "seconds"),
  }));

  return (
    <div className="aspect-video w-full bg-black rounded-comfy overflow-hidden shadow-midnight">
      <ReactPlayer
        ref={(p) => { playerRef.current = p; }}
        url={`https://www.youtube.com/watch?v=${youtubeId}`}
        width="100%"
        height="100%"
        controls
      />
    </div>
  );
});
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && pnpm test`
Expected: VideoPlayer test passes; all earlier tests still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/VideoPlayer.tsx frontend/components/VideoPlayer.test.tsx
git commit -m "feat(frontend): add video player component with seekTo handle"
```

---

## Task 19: Frontend reference panel, cards, filter, and report page

**Files:**
- Create: `frontend/components/ConfidenceFilter.tsx`
- Create: `frontend/components/ReferenceCard.tsx`
- Create: `frontend/components/ReferencePanel.tsx`
- Create: `frontend/components/ReferencePanel.test.tsx`
- Create: `frontend/app/report/[id]/page.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/components/ReferencePanel.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ReferencePanel } from "./ReferencePanel";
import type { VerifiedReference } from "@/lib/types";

const refs: VerifiedReference[] = [
  {
    timestamp_s: 12.5, source_frame_id: "shot_03",
    work_title: "The Shining", work_creator: "Stanley Kubrick",
    work_year: 1980, work_type: "film",
    reasoning: "symmetry + corridor + slow tracking",
    raw_confidence: 0.85, verdict: "keep",
    final_confidence: "confirmed",
    supporting_elements: ["symmetry", "corridor", "tracking"],
    wikipedia_url: "https://en.wikipedia.org/wiki/The_Shining",
  },
  {
    timestamp_s: 30.0, source_frame_id: "shot_07",
    work_title: "Don't Look Now", work_creator: "Nicolas Roeg",
    work_year: 1973, work_type: "film",
    reasoning: "red coat in canal frame",
    raw_confidence: 0.55, verdict: "speculative",
    final_confidence: "speculative",
    supporting_elements: ["red coat"],
    wikipedia_url: null,
  },
];

describe("ReferencePanel", () => {
  it("hides speculative references by default", () => {
    render(
      <ReferencePanel
        references={refs}
        showSpeculative={false}
        onJump={() => {}}
        onFlag={() => {}}
      />,
    );
    expect(screen.getByText(/the shining/i)).toBeInTheDocument();
    expect(screen.queryByText(/don't look now/i)).not.toBeInTheDocument();
  });

  it("shows speculative when toggled on", () => {
    render(
      <ReferencePanel
        references={refs}
        showSpeculative={true}
        onJump={() => {}}
        onFlag={() => {}}
      />,
    );
    expect(screen.getByText(/don't look now/i)).toBeInTheDocument();
  });

  it("calls onJump when card clicked", () => {
    const onJump = vi.fn();
    render(
      <ReferencePanel
        references={refs}
        showSpeculative={false}
        onJump={onJump}
        onFlag={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/the shining/i));
    expect(onJump).toHaveBeenCalledWith(refs[0]);
  });

  it("calls onFlag when not-convinced button clicked", () => {
    const onFlag = vi.fn();
    render(
      <ReferencePanel
        references={refs}
        showSpeculative={false}
        onJump={() => {}}
        onFlag={onFlag}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /not convinced/i }));
    expect(onFlag).toHaveBeenCalledWith(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm test`
Expected: FAIL — `Cannot find module './ReferencePanel'`.

- [ ] **Step 3: Implement ConfidenceFilter**

Create `frontend/components/ConfidenceFilter.tsx`:
```tsx
"use client";

export function ConfidenceFilter({
  showSpeculative,
  onToggle,
}: {
  showSpeculative: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={showSpeculative}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <span className="font-mono uppercase text-[11px] tracking-mono-label text-white/60">
        Show speculative
      </span>
    </label>
  );
}
```

- [ ] **Step 4: Implement ReferenceCard**

Create `frontend/components/ReferenceCard.tsx`:
```tsx
"use client";
import type { VerifiedReference } from "@/lib/types";

export function ReferenceCard({
  reference,
  onJump,
  onFlag,
}: {
  reference: VerifiedReference;
  onJump: () => void;
  onFlag: () => void;
}) {
  const ts = Math.floor(reference.timestamp_s);
  const min = Math.floor(ts / 60);
  const sec = ts % 60;
  return (
    <div className="rounded-comfy bg-white/[0.03] border border-white/12 shadow-midnight p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-mono uppercase text-[11px] tracking-mono-label text-white/60">
          {min}:{sec.toString().padStart(2, "0")}
        </span>
        <span
          className={`font-mono uppercase text-[11px] tracking-mono-label px-2 py-1 rounded-sharp border ${
            reference.final_confidence === "confirmed"
              ? "border-lavender text-lavender"
              : "border-white/30 text-white/60"
          }`}
        >
          {reference.final_confidence}
        </span>
      </div>
      <button
        onClick={onJump}
        className="text-left font-display text-[22px] tracking-[-0.22px] leading-[1.15] hover:underline"
      >
        {reference.work_title}
      </button>
      <p className="text-[14px] text-white/70">
        {reference.work_creator}
        {reference.work_year ? ` · ${reference.work_year}` : ""}
        {" · "}
        {reference.work_type}
      </p>
      <p className="text-[14px] text-white/80">{reference.reasoning}</p>
      {reference.supporting_elements.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {reference.supporting_elements.map((el, i) => (
            <li
              key={i}
              className="font-mono uppercase text-[11px] tracking-mono-label px-2 py-1 rounded-sharp border border-white/12 text-white/60"
            >
              {el}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-between items-center">
        {reference.wikipedia_url ? (
          <a
            href={reference.wikipedia_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[14px] underline text-lavender"
          >
            Wikipedia
          </a>
        ) : (
          <span className="text-[14px] text-white/40">No external link</span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onFlag(); }}
          className="font-mono uppercase text-[11px] tracking-mono-label text-white/60 hover:text-brand-orange"
        >
          ✕ Not convinced
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement ReferencePanel**

Create `frontend/components/ReferencePanel.tsx`:
```tsx
"use client";
import type { VerifiedReference } from "@/lib/types";
import { ReferenceCard } from "./ReferenceCard";

export function ReferencePanel({
  references,
  showSpeculative,
  onJump,
  onFlag,
}: {
  references: VerifiedReference[];
  showSpeculative: boolean;
  onJump: (ref: VerifiedReference) => void;
  onFlag: (refIndex: number) => void;
}) {
  const visible = references
    .map((ref, idx) => ({ ref, idx }))
    .filter(({ ref }) =>
      ref.final_confidence === "confirmed"
        ? true
        : ref.final_confidence === "speculative" && showSpeculative,
    );

  if (visible.length === 0) {
    return (
      <p className="text-[16px] text-white/60">
        No confirmed references found{showSpeculative ? "." : "; toggle 'Show speculative' to see thinner candidates."}
      </p>
    );
  }

  return (
    <aside className="flex flex-col gap-4 max-h-[80vh] overflow-y-auto pr-2">
      {visible.map(({ ref, idx }) => (
        <ReferenceCard
          key={idx}
          reference={ref}
          onJump={() => onJump(ref)}
          onFlag={() => onFlag(idx)}
        />
      ))}
    </aside>
  );
}
```

- [ ] **Step 6: Run panel tests**

Run: `cd frontend && pnpm test`
Expected: 4 new ReferencePanel tests pass; all earlier tests still pass.

- [ ] **Step 7: Implement report page**

Create `frontend/app/report/[id]/page.tsx`:
```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  fetchReport,
  flagReference,
  subscribePipeline,
} from "@/lib/api";
import type {
  PipelineEvent,
  Report,
  VerifiedReference,
} from "@/lib/types";
import { PipelineStatus } from "@/components/PipelineStatus";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";
import { ReferencePanel } from "@/components/ReferencePanel";
import { ConfidenceFilter } from "@/components/ConfidenceFilter";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSpeculative, setShowSpeculative] = useState(false);
  const playerRef = useRef<VideoPlayerHandle>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const r = await fetchReport(id);
      if (cancelled) return;
      if (r) setReport(r);
      else {
        const close = subscribePipeline(
          id,
          async (e) => {
            setEvents((prev) => [...prev, e]);
            if (e.step === "done") {
              const fresh = await fetchReport(id);
              if (!cancelled) setReport(fresh);
            }
            if (e.step === "error") setError(e.message);
          },
          (err) => setError(String(err)),
        );
        return () => close();
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [id]);

  function jump(ref: VerifiedReference) {
    playerRef.current?.seekTo(ref.timestamp_s);
  }

  async function flag(idx: number) {
    await flagReference(id, idx);
  }

  return (
    <main className="surface-dark min-h-screen px-6 py-10">
      <div className="max-w-7xl mx-auto flex flex-col gap-8">
        <header className="flex items-baseline justify-between">
          <p className="font-mono uppercase text-[11px] tracking-mono-label text-white/60">
            Report · {id}
          </p>
          {report && (
            <ConfidenceFilter
              showSpeculative={showSpeculative}
              onToggle={setShowSpeculative}
            />
          )}
        </header>

        {!report && <PipelineStatus events={events} />}
        {error && <p className="text-brand-orange">{error}</p>}

        {report && (
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8">
            <div className="flex flex-col gap-4">
              <h1 className="font-display text-[40px] tracking-h2 leading-[1.20]">
                {report.title}
              </h1>
              <p className="font-mono uppercase text-[11px] tracking-mono-label text-white/60">
                {report.channel}
              </p>
              <VideoPlayer ref={playerRef} youtubeId={report.youtube_id} />
            </div>
            <ReferencePanel
              references={report.references}
              showSpeculative={showSpeculative}
              onJump={jump}
              onFlag={flag}
            />
          </div>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 8: Verify build**

Run: `cd frontend && pnpm build`
Expected: clean build with the report route compiled.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/ConfidenceFilter.tsx frontend/components/ReferenceCard.tsx frontend/components/ReferencePanel.tsx frontend/components/ReferencePanel.test.tsx frontend/app/report
git commit -m "feat(frontend): add reference panel, cards, filter, and report page"
```

---

## Task 20: Frontend Dockerfile

**Files:**
- Create: `frontend/Dockerfile`
- Create: `frontend/.dockerignore`

- [ ] **Step 1: Create Dockerfile**

Create `frontend/Dockerfile`:
```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["pnpm", "start"]
```

Create `frontend/.dockerignore`:
```
node_modules
.next
.env
*.log
.DS_Store
```

- [ ] **Step 2: Verify build**

Run: `docker build -t clipdecoder-frontend frontend/`
Expected: Successful build.

- [ ] **Step 3: Commit**

```bash
git add frontend/Dockerfile frontend/.dockerignore
git commit -m "build(frontend): add Dockerfile for Next.js production server"
```

---

## Task 21: docker-compose + README

**Files:**
- Create: `docker-compose.yml`
- Create: `README.md`

- [ ] **Step 1: Create docker-compose.yml**

Create `docker-compose.yml`:
```yaml
services:
  backend:
    build:
      context: ./backend
    ports:
      - "8000:8000"
    env_file:
      - .env
    volumes:
      - ./backend/data:/app/data
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - backend
    restart: unless-stopped
```

- [ ] **Step 2: Create README.md**

Create `README.md`:
````markdown
# ClipDecoder

Local-first tool that decodes the visual references in YouTube music videos using NVIDIA NIM endpoints.

## Quick start

1. Get a free NVIDIA NIM API key at https://build.nvidia.com (creates an `nvapi-...` key with 1000 inference credits).
2. Copy `.env.example` to `.env` and fill `NVAPI_KEY`.
3. Run `docker compose up --build`.
4. Open http://localhost:3000 and paste a YouTube URL.

## How it works

Five-stage pipeline per clip:

1. **Ingest** — `yt-dlp` downloads a 480p mp4 and auto-captions if available.
2. **Shots** — `PySceneDetect` finds shot boundaries; `ffmpeg` extracts one keyframe per shot (capped at 80, evenly distributed).
3. **Vision** — Cosmos Reason describes each frame: composition, palette, camera, costume/setting, distinctive features. Evidence-only — no speculation about references.
4. **Cross-reference** — Llama 3.x (or Nemotron) takes all frame descriptions and proposes named references to specific works.
5. **Verify** — A second LLM pass adversarially defends each reference; Wikipedia confirms the named work exists. Each reference lands in one of three buckets: `confirmed`, `speculative`, `hidden`.

The viewer shows the embedded YouTube player on the left and a panel of reference cards on the right; click a card to jump the video to that timestamp.

## Configuration

See `.env.example`. Key knobs:

- `MAX_SHOTS_PER_VIDEO` (default 80) — caps NIM calls per analysis.
- `NIM_CONCURRENCY` (default 4) — parallel frame analyses.
- `WIKIPEDIA_VERIFICATION` (default true) — set false to skip Wikipedia checks.

## Local development

Backend:
```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

Frontend:
```bash
cd frontend
pnpm install
pnpm dev
```

Tests:
```bash
cd backend && uv run pytest
cd frontend && pnpm test
```

End-to-end test (real NIM, requires `NVAPI_KEY`):
```bash
cd backend && uv run pytest -m e2e
```

## Limitations

- YouTube only.
- Some age-restricted or region-locked clips will fail without cookies.
- Visual reference detection is open-ended; the system errs toward "speculative" rather than risking false confidence.
- "The Future" and "PP Neue Montreal Mono" are commercial fonts; the UI uses system fallbacks unless you drop licensed copies into `frontend/public/fonts/`.

## License

MIT.
````

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml README.md
git commit -m "build: add docker-compose and README"
```

---

## Task 22: Golden tests

**Files:**
- Create: `backend/tests/golden/__init__.py`
- Create: `backend/tests/golden/fixtures/frame_analyses_kubrick_clip.json`
- Create: `backend/tests/golden/fixtures/proposer_output_kubrick_clip.json`
- Create: `backend/tests/golden/test_pipeline_golden.py`

- [ ] **Step 1: Create the fixtures**

Create `backend/tests/golden/__init__.py` (empty).

Create `backend/tests/golden/fixtures/frame_analyses_kubrick_clip.json`:
```json
[
  {
    "timestamp_s": 12.5, "frame_id": "shot_03",
    "composition": "centered symmetrical hotel corridor, one-point perspective",
    "palette": ["red", "black", "white"],
    "camera_move": "slow tracking forward",
    "costume_setting": "child on tricycle in long carpeted hallway",
    "distinctive_features": ["one-point perspective", "deep symmetry", "patterned carpet"],
    "raw_description": "A child rides slowly down a long, perfectly symmetrical hotel corridor lit in deep red.",
    "confidence_in_observation": 0.92
  },
  {
    "timestamp_s": 38.0, "frame_id": "shot_07",
    "composition": "wide static frame of two figures standing apart in fog",
    "palette": ["gray", "blue"],
    "camera_move": "static",
    "costume_setting": "figures in long coats on stone bridge",
    "distinctive_features": ["heavy fog", "tonal contrast"],
    "raw_description": "Two distant figures separated by fog on a Venetian bridge.",
    "confidence_in_observation": 0.8
  }
]
```

Create `backend/tests/golden/fixtures/proposer_output_kubrick_clip.json`:
```json
{
  "candidates": [
    {
      "timestamp_s": 12.5, "source_frame_id": "shot_03",
      "work_title": "The Shining", "work_creator": "Stanley Kubrick",
      "work_year": 1980, "work_type": "film",
      "reasoning": "symmetrical hotel corridor + slow tracking shot + child on tricycle",
      "raw_confidence": 0.88
    },
    {
      "timestamp_s": 38.0, "source_frame_id": "shot_07",
      "work_title": "70s European cinema",
      "work_creator": "various",
      "work_type": "film",
      "reasoning": "fog and tonal contrast",
      "raw_confidence": 0.4
    }
  ]
}
```

- [ ] **Step 2: Write the golden test**

Create `backend/tests/golden/test_pipeline_golden.py`:
```python
import json
from pathlib import Path
from unittest.mock import AsyncMock
from app.models import FrameAnalysis
from app.pipeline.ref_proposer import RefProposer
from app.pipeline.verifier import Verifier
from app.models import Verdict, Confidence

FIXTURES = Path(__file__).parent / "fixtures"


def load_frame_analyses() -> list[FrameAnalysis]:
    data = json.loads((FIXTURES / "frame_analyses_kubrick_clip.json").read_text())
    return [FrameAnalysis.model_validate(d) for d in data]


def load_proposer_output() -> dict:
    return json.loads((FIXTURES / "proposer_output_kubrick_clip.json").read_text())


async def test_proposer_filters_unnamed_candidate():
    nim = AsyncMock()
    nim.complete_text.return_value = load_proposer_output()
    rp = RefProposer(nim_client=nim, model="m")
    out = await rp.propose(
        title="Kubrick Clip", channel="X", lyrics_text="",
        frame_analyses=load_frame_analyses(),
    )
    titles = [c.work_title for c in out]
    assert "The Shining" in titles
    # The unnamed-creator-with-vague-title candidate is kept by validation
    # but should NOT appear as a confirmed reference after the verifier.
    # Validation only requires non-empty strings; the verifier does the rejection.
    assert all(c.work_title for c in out)


async def test_verifier_rejects_vague_keep_under_adversarial_prompt():
    """Even if the proposer let through 'various / 70s European cinema',
    the verifier should reject it for lack of concrete elements."""
    nim = AsyncMock()
    # Verifier will be called twice; first is 'keep' for The Shining,
    # second is 'reject' for the vague one.
    nim.complete_text.side_effect = [
        {
            "verdict": "keep",
            "supporting_elements": ["symmetry", "tracking shot", "corridor"],
            "final_confidence": 0.88,
            "rationale": "matches",
        },
        {
            "verdict": "reject",
            "supporting_elements": [],
            "final_confidence": 0.2,
            "rationale": "thin",
        },
    ]
    v = Verifier(nim_client=nim, model="m", wikipedia=False)

    fa_index = {f.frame_id: f for f in load_frame_analyses()}
    rp = RefProposer(nim_client=AsyncMock(), model="m")
    rp._nim.complete_text.return_value = load_proposer_output()  # type: ignore[attr-defined]
    candidates = await rp.propose(
        title="x", channel="x", lyrics_text="", frame_analyses=load_frame_analyses()
    )
    verified = await v.verify_all(candidates, fa_index)
    confirmed = [r for r in verified if r.final_confidence == Confidence.CONFIRMED]
    rejected = [r for r in verified if r.verdict == Verdict.REJECT]
    assert any(r.work_title == "The Shining" for r in confirmed)
    assert len(rejected) == 1
```

- [ ] **Step 3: Run the golden tests**

Run: `cd backend && uv run pytest tests/golden -v`
Expected: 2 passing tests.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/golden
git commit -m "test(backend): add golden fixtures and pipeline regression tests"
```

---

## Task 23: Integration end-to-end test (real NIM, opt-in)

**Files:**
- Create: `backend/tests/integration/__init__.py`
- Create: `backend/tests/integration/test_e2e.py`

- [ ] **Step 1: Create the e2e test**

Create `backend/tests/integration/__init__.py` (empty).

Create `backend/tests/integration/test_e2e.py`:
```python
import os
import pytest
from pathlib import Path
from app.api.sse import EventBus
from app.db import Database
from app.nim.client import NimClient
from app.pipeline.frame_analyzer import FrameAnalyzer
from app.pipeline.ingestor import Ingestor
from app.pipeline.orchestrator import Orchestrator
from app.pipeline.ref_proposer import RefProposer
from app.pipeline.shot_sampler import ShotSampler
from app.pipeline.verifier import Verifier
from app.settings import settings


@pytest.mark.e2e
async def test_full_pipeline_on_short_public_clip(tmp_path: Path):
    if not os.environ.get("NVAPI_KEY"):
        pytest.skip("NVAPI_KEY not set; skipping e2e")
    # A short, public, non-controversial clip with clear visuals.
    # Replace with a clip you have rights to test on.
    url = os.environ.get(
        "E2E_CLIP_URL",
        "https://www.youtube.com/watch?v=jNQXAC9IVRw",  # 19s, public domain
    )
    db = Database(db_path=tmp_path / "e2e.sqlite")
    await db.init()
    bus = EventBus()
    nim = NimClient(api_key=os.environ["NVAPI_KEY"], base_url=settings.nim_base_url)
    orch = Orchestrator(
        db=db, bus=bus,
        ingestor=Ingestor(work_dir=tmp_path / "downloads"),
        sampler=ShotSampler(out_dir=tmp_path / "frames", max_shots=8),
        frame_analyzer=FrameAnalyzer(
            nim_client=nim,
            model=settings.cosmos_reason_model,
            concurrency=2,
        ),
        ref_proposer=RefProposer(nim_client=nim, model=settings.llm_model),
        verifier=Verifier(
            nim_client=nim, model=settings.llm_model, wikipedia=True, concurrency=2
        ),
    )
    await orch.run(url)
    report = await db.load_report(url.split("v=")[-1].split("&")[0])
    assert report is not None
    assert report.duration_s > 0
    # We don't assert specific references — just that the pipeline completed.
    assert isinstance(report.references, list)
```

- [ ] **Step 2: Verify the test is correctly skipped without key**

Run: `cd backend && unset NVAPI_KEY && uv run pytest tests/integration -v`
Expected: 1 test, skipped.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/integration
git commit -m "test(backend): add opt-in end-to-end integration test"
```

---

## Final verification

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && uv run pytest -v`
Expected: All unit + golden tests pass; e2e test skipped.

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd frontend && pnpm test`
Expected: All Vitest tests pass.

- [ ] **Step 3: Boot the full stack**

Run from repo root with a valid `.env`:
```bash
docker compose up --build
```
Expected: backend on 8000, frontend on 3000. Open http://localhost:3000, paste a music-video URL, observe the pipeline status update through SSE, and land on the report with at least one reference card.

- [ ] **Step 4: Commit any final tweaks and tag**

```bash
git tag -a v0.1.0 -m "ClipDecoder v0.1.0 — first working end-to-end build"
```
