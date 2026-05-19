"use client";
import { useMemo } from "react";
import type { FrameAnalysis, Report } from "@/lib/types";
import { DetailSlate } from "./DetailSlate";
import { DetailTopRow } from "./DetailTopRow";
import { DetailCompare } from "./DetailCompare";
import { DetailReasoning } from "./DetailReasoning";
import { DetailFrameAnalysis } from "./DetailFrameAnalysis";
import { useDetailKeyboardNav } from "./useDetailKeyboardNav";

export function ReferenceDetail({
  report,
  index,
}: {
  report: Report;
  index: number;
}) {
  const reference = report.references[index];
  const total = report.references.length;
  const youtubeId = report.youtube_id;

  useDetailKeyboardNav({ youtubeId, index, total });

  const frameById = useMemo(() => {
    const m = new Map<string, FrameAnalysis>();
    for (const f of report.frame_analyses) m.set(f.frame_id, f);
    return m;
  }, [report.frame_analyses]);
  const frame = frameById.get(reference.source_frame_id);

  return (
    <main className="relative isolate min-h-screen flex flex-col overflow-hidden bg-canvas text-ink detail-root">
      <div aria-hidden className="aurora aurora-report" />
      <div aria-hidden className="aurora aurora-report-b" />
      <div aria-hidden className="grain" />
      <DetailSlate
        youtubeId={youtubeId}
        reference={reference}
        index={index}
        total={total}
      />
      <div className="relative z-[1] grid gap-6 px-[clamp(32px,5vw,64px)] py-[clamp(32px,4vw,56px)]">
        <DetailTopRow reference={reference} />
        <DetailCompare
          reference={reference}
          frame={frame}
          youtubeId={youtubeId}
          frameIndex={index}
        />
        <div className="grid items-start grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-6 max-[900px]:grid-cols-1">
          <DetailReasoning
            crossRef={reference.cross_ref_reasoning}
            adversarial={reference.adversarial_reasoning}
            wikipedia={reference.wikipedia_reasoning}
          />
          <DetailFrameAnalysis
            frame={frame}
            rawConfidence={reference.raw_confidence}
          />
        </div>
      </div>
    </main>
  );
}
