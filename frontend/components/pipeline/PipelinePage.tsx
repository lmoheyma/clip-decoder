"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  IngestPayload,
  PipelineEvent,
  ShotsPayload,
  VisionFramePayload,
} from "@/lib/types";
import { PipelineSlate } from "./PipelineSlate";
import { ClipMetadataPane } from "./ClipMetadataPane";
import { PipelineList } from "./PipelineList";
import { NowFrame } from "./NowFrame";
import { KeyframeStrip } from "./KeyframeStrip";
import { LogPane } from "./LogPane";
import { CandidatesPane } from "./CandidatesPane";

export function PipelinePage({
  youtubeId,
  events,
  error,
}: {
  youtubeId: string;
  events: PipelineEvent[];
  error: string | null;
}) {
  const [startTs, setStartTs] = useState<number | null>(null);
  useEffect(() => {
    if (events.length > 0 && startTs === null) {
      setStartTs(Date.now());
    }
  }, [events.length, startTs]);

  const clipMeta = useMemo<IngestPayload | null>(() => {
    const ingest = events.find((e) => e.step === "ingest");
    return ingest ? (ingest.payload as unknown as IngestPayload) : null;
  }, [events]);

  const keyframes = useMemo(() => {
    // Use findLast: the orchestrator emits an early "Detecting scenes…"
    // shots event with no payload, then the final shots event with the
    // full keyframes array. We want the latter.
    const shots = events.findLast((e) => e.step === "shots");
    return (shots?.payload as ShotsPayload | undefined)?.keyframes ?? [];
  }, [events]);

  const visionFrames = useMemo(
    () =>
      events
        .filter((e) => e.step === "vision_frame")
        .map((e) => e.payload as unknown as VisionFramePayload),
    [events],
  );

  const lastVisionFrame = visionFrames[visionFrames.length - 1] ?? null;
  const analyzedIds = useMemo(
    () => new Set(visionFrames.map((p) => p.frame_id)),
    [visionFrames],
  );

  if (error) {
    return (
      <main className="frame surface-dark relative min-h-screen flex flex-col pipeline-root">
        <div aria-hidden className="aurora aurora-report" />
        <div aria-hidden className="aurora aurora-report-b" />
        <div aria-hidden className="grain" />
        <PipelineSlate youtubeId={youtubeId} startTs={startTs} />
        <div style={{ padding: "clamp(48px, 6vw, 80px)", maxWidth: 760, position: "relative", zIndex: 1 }}>
          <div className="pipeline-eyebrow">Pipeline error</div>
          <h1 className="pipeline-h1" role="alert">
            {error}
          </h1>
          <Link className="not-found-cta" href="/" style={{ marginTop: 32 }}>
            ← Try another clip
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="frame surface-dark relative min-h-screen flex flex-col pipeline-root">
      <div aria-hidden className="aurora aurora-report" />
      <div aria-hidden className="aurora aurora-report-b" />
      <div aria-hidden className="grain" />
      <PipelineSlate youtubeId={youtubeId} startTs={startTs} />

      <div className="pipeline-stage">
        <div className="pipeline-col-left">
          <h2 className="pipeline-h2">
            <em>Reading</em>
            <br />
            the tape.
          </h2>
          <ClipMetadataPane meta={clipMeta} youtubeId={youtubeId} />
          <PipelineList events={events} />
        </div>

        <div className="pipeline-col-center">
          <NowFrame frame={lastVisionFrame} youtubeId={youtubeId} />
          <KeyframeStrip
            keyframes={keyframes}
            analyzedIds={analyzedIds}
            latestId={lastVisionFrame?.frame_id ?? null}
            youtubeId={youtubeId}
          />
          <LogPane events={events} />
        </div>

        <div className="pipeline-col-right">
          <CandidatesPane events={events} />
        </div>
      </div>
    </main>
  );
}
