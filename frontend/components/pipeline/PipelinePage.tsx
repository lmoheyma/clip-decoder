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
import { PipelineFooterSlate } from "./PipelineFooterSlate";

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
    const shots = events.find((e) => e.step === "shots");
    return shots
      ? (shots.payload as unknown as ShotsPayload).keyframes
      : [];
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
      <main className="frame surface-dark relative min-h-screen flex flex-col">
        <PipelineSlate youtubeId={youtubeId} startTs={startTs} />
        <div style={{ padding: "clamp(32px, 5vw, 64px)", maxWidth: 720 }}>
          <div className="hairline" style={{ marginBottom: 16, color: "var(--error)" }}>
            Pipeline error
          </div>
          <h1
            className="serif-it"
            style={{ fontSize: "clamp(28px, 4vw, 48px)", color: "var(--ink)" }}
            role="alert"
          >
            {error}
          </h1>
          <Link
            className="ulink"
            href="/"
            style={{ marginTop: 24, display: "inline-block" }}
          >
            ← Try another clip
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="frame surface-dark relative min-h-screen flex flex-col">
      <PipelineSlate youtubeId={youtubeId} startTs={startTs} />

      <div className="pipeline-stage">
        <div className="pipeline-col-left">
          <h2 className="pipeline-h2 serif-it">
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

      <PipelineFooterSlate />
    </main>
  );
}
