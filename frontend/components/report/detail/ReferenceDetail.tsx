"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();

  useDetailKeyboardNav({ youtubeId, index, total });

  const frameById = useMemo(() => {
    const m = new Map<string, FrameAnalysis>();
    for (const f of report.frame_analyses) m.set(f.frame_id, f);
    return m;
  }, [report.frame_analyses]);
  const frame = frameById.get(reference.source_frame_id);

  function handleJump() {
    router.push(`/report/${youtubeId}#t=${reference.timestamp_s}`);
  }

  return (
    <main className="frame surface-dark relative min-h-screen flex flex-col">
      <DetailSlate
        youtubeId={youtubeId}
        reference={reference}
        index={index}
        total={total}
      />
      <div className="detail">
        <DetailTopRow reference={reference} onJump={handleJump} />
        <DetailCompare
          reference={reference}
          frame={frame}
          youtubeId={youtubeId}
          frameIndex={index}
        />
        <div className="detail-evidence">
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
