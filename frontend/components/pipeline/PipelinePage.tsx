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
      <main className="relative isolate min-h-screen flex flex-col overflow-hidden bg-canvas text-ink pipeline-root">
        <div aria-hidden className="aurora aurora-report" />
        <div aria-hidden className="aurora aurora-report-b" />
        <div aria-hidden className="grain" />
        <PipelineSlate youtubeId={youtubeId} startTs={startTs} />
        <div className="relative z-[1] max-w-[760px] p-[clamp(48px,6vw,80px)]">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-error mb-6">Pipeline error</div>
          <h1
            role="alert"
            className="m-0 font-serif font-light text-ink leading-[0.96] tracking-[-0.025em] text-[clamp(40px,5.4vw,80px)] [font-variation-settings:'SOFT'_100]"
          >
            {error}
          </h1>
          <Link
            href="/"
            className="inline-block mt-8 px-[22px] py-3 rounded-full border border-hairline-strong font-sans text-[11px] uppercase tracking-[0.14em] text-body no-underline transition-colors duration-200 hover:text-ink hover:border-ink"
          >
            ← Try another clip
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="relative isolate min-h-screen flex flex-col overflow-hidden bg-canvas text-ink pipeline-root">
      <div aria-hidden className="aurora aurora-report" />
      <div aria-hidden className="aurora aurora-report-b" />
      <div aria-hidden className="grain" />
      <PipelineSlate youtubeId={youtubeId} startTs={startTs} />

      <div className="relative z-[1] grid grid-cols-1 lg:grid-cols-[350px_minmax(0,1fr)_320px] gap-6 pt-[clamp(28px,4vw,48px)] px-[clamp(32px,5vw,64px)] pb-8">
        <div className="flex flex-col gap-4 min-w-0">
          <h2 className="m-0 mb-7 font-serif font-light text-ink leading-[0.96] tracking-[-0.025em] text-[clamp(38px,4.4vw,64px)] [font-variation-settings:'SOFT'_100]">
            <em className="italic font-normal text-grad-lavender">Reading</em>
            <br />
            the tape.
          </h2>
          <ClipMetadataPane meta={clipMeta} youtubeId={youtubeId} />
          <PipelineList events={events} />
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <NowFrame frame={lastVisionFrame} youtubeId={youtubeId} />
          <KeyframeStrip
            keyframes={keyframes}
            analyzedIds={analyzedIds}
            latestId={lastVisionFrame?.frame_id ?? null}
            youtubeId={youtubeId}
          />
          <LogPane events={events} />
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <CandidatesPane events={events} />
        </div>
      </div>
    </main>
  );
}
