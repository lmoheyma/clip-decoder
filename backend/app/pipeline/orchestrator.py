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
