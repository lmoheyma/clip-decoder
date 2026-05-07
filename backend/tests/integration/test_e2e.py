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
