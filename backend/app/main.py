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
from app.pipeline.wikidata_enricher import WikidataEnricher
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
        orphans = await db.mark_orphans_as_error(
            "Pipeline interrupted (server restarted before completion)."
        )
        if orphans:
            logging.getLogger(__name__).info(
                "marked %d orphaned running analyses as error", orphans
            )
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
    enricher = (
        WikidataEnricher(
            concurrency=settings.wikidata_concurrency,
            timeout_s=settings.wikidata_timeout_s,
        )
        if settings.wikidata_enrichment
        else None
    )
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
        enricher=enricher,
    )
    return build_app(db=db, bus=bus, run_pipeline=orch.run)


app = _build_default_app()
