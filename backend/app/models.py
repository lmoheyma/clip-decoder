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
    start_s: Annotated[float, Field(ge=0.0)]
    end_s: Annotated[float, Field(ge=0.0)]
    text: str


class IngestResult(BaseModel):
    youtube_id: str
    video_path: Path
    title: str
    channel: str
    duration_s: Annotated[float, Field(ge=0.0)]
    captions: list[Caption] = []

    model_config = ConfigDict(arbitrary_types_allowed=True)


class KeyFrame(BaseModel):
    shot_id: str
    timestamp_s: Annotated[float, Field(ge=0.0)]
    frame_path: Path

    model_config = ConfigDict(arbitrary_types_allowed=True)


class FrameAnalysis(BaseModel):
    timestamp_s: Annotated[float, Field(ge=0.0)]
    frame_id: str
    composition: str
    palette: list[str]
    palette_hex: list[str] = []
    camera_move: str
    costume_setting: str
    distinctive_features: list[str]
    raw_description: str
    confidence_in_observation: Annotated[float, Field(ge=0.0, le=1.0)]


class LyricLink(BaseModel):
    lyric_timestamp_s: Annotated[float, Field(ge=0.0)]
    lyric: str
    frame_id: str
    frame_timestamp_s: Annotated[float, Field(ge=0.0)]
    relation: str  # literal | motif | contrast | amplification | other
    note: str


class ReferenceCandidate(BaseModel):
    timestamp_s: Annotated[float, Field(ge=0.0)]
    source_frame_id: str
    work_title: Annotated[str, Field(min_length=1)]
    work_creator: Annotated[str, Field(min_length=1)]
    work_year: int | None = None
    work_type: str  # painting | photograph | music_video | film | album_cover | fashion_editorial | ad_campaign | archival_footage | other
    raw_confidence: Annotated[float, Field(ge=0.0, le=1.0)]


class VerifiedReference(ReferenceCandidate):
    verdict: Verdict
    final_confidence: Confidence
    supporting_elements: list[str]
    wikipedia_url: str | None = None
    wikipedia_thumbnail_url: str | None = None
    # Reasoning fields produced by the verifier prompt (Task 3+5).
    cross_ref_reasoning: str
    adversarial_reasoning: str
    wikipedia_reasoning: str
    # Wikidata enrichment fields filled by WikidataEnricher (Task 7-10).
    # All default to None when no Wikipedia URL was found, or Wikidata
    # had no claim for the field.
    medium: str | None = None
    institution: str | None = None
    inception_year: int | None = None


class Report(BaseModel):
    youtube_id: str
    title: str
    channel: str
    duration_s: Annotated[float, Field(ge=0.0)]
    references: list[VerifiedReference]
    frame_analyses: list[FrameAnalysis]
    lyrics_links: list[LyricLink] = []


class PipelineEvent(BaseModel):
    step: str  # ingest | shots | vision | crossref | verify | done | error
    message: str
    progress: Annotated[float, Field(ge=0.0, le=1.0)] = 0.0
    payload: dict = {}
