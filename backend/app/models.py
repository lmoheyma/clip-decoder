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
