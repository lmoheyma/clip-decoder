from __future__ import annotations
import asyncio
import logging
import re
from typing import Awaitable, Callable
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.api.sse import EventBus
from app.db import AnalysisStatus, Database
from app.pipeline.ingestor import parse_youtube_id
from app.settings import settings

logger = logging.getLogger(__name__)

_YOUTUBE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")
_FRAME_ID_RE = re.compile(r"^shot_\d+$")


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
        result = await db.load_report_meta(youtube_id)
        if result is None:
            raise HTTPException(status_code=404, detail="report not found")
        report, created_at = result
        return {
            **report.model_dump(mode="json"),
            "created_at": created_at.isoformat(),
        }

    @router.post("/report/{youtube_id}/flag")
    async def flag(youtube_id: str, body: FlagBody) -> dict[str, str]:
        await db.flag_reference(youtube_id, body.ref_index, body.reason)
        return {"status": "ok"}

    @router.get("/frames/{youtube_id}/{frame_id}")
    def get_frame(youtube_id: str, frame_id: str):
        if not _YOUTUBE_ID_RE.fullmatch(youtube_id):
            raise HTTPException(status_code=400, detail="invalid youtube_id format")
        if not _FRAME_ID_RE.fullmatch(frame_id):
            raise HTTPException(status_code=400, detail="invalid frame_id format")
        path = settings.data_dir / "frames" / youtube_id / f"{frame_id}.jpg"
        if not path.exists():
            raise HTTPException(status_code=404, detail="frame not found")
        return FileResponse(
            path,
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )

    @router.get("/stream/{youtube_id}")
    async def stream(youtube_id: str):
        async def gen():
            # If the orchestrator is no longer alive for this id (server
            # restarted after the run finished or errored, or this id was
            # never run in the current process), the in-memory bus has no
            # history and bus.subscribe would block forever. Synthesize a
            # terminal event from the DB instead so the frontend resolves.
            if not bus.has_history(youtube_id):
                status = await db.get_status(youtube_id)
                if status in (AnalysisStatus.DONE, AnalysisStatus.ERROR):
                    from app.models import PipelineEvent

                    if status == AnalysisStatus.ERROR:
                        err = await db.get_error(youtube_id) or "Pipeline failed."
                        ev = PipelineEvent(
                            step="error", message=err, progress=0.0, payload={}
                        )
                    else:
                        ev = PipelineEvent(
                            step="done", message="Done.", progress=1.0, payload={}
                        )
                    yield {"event": ev.step, "data": ev.model_dump_json()}
                    return

            async for ev in bus.subscribe(youtube_id):
                yield {"event": ev.step, "data": ev.model_dump_json()}

        return EventSourceResponse(gen())

    return router
