"use client";
import { useEffect, useRef } from "react";

const CELL_BASE =
  "shrink-0 w-[90px] h-[60px] relative rounded-1 overflow-hidden border-2 border-transparent";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
}

export function KeyframeStrip({
  keyframes,
  analyzedIds,
  latestId,
  youtubeId,
}: {
  keyframes: { shot_id: string; timestamp_s: number }[];
  analyzedIds: Set<string>;
  latestId: string | null;
  youtubeId: string;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const latestCellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (latestId && latestCellRef.current) {
      latestCellRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [latestId]);

  const analyzedCount = analyzedIds.size;
  const pendingCount = keyframes.length - analyzedCount;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between font-sans text-[11px] uppercase tracking-uc text-muted">
        <span>EXTRACTED KEYFRAMES</span>
        <span>
          {analyzedCount} analysed · {pendingCount} pending
        </span>
      </div>
      <div ref={stripRef} className="flex gap-1.5 overflow-x-auto pb-1 scroll-smooth">
        {keyframes.map((kf) => {
          const isAnalyzed = analyzedIds.has(kf.shot_id);
          const isLatest = kf.shot_id === latestId;
          const stateClass = `${isAnalyzed ? "analyzed" : "pending"} ${isLatest ? "latest" : ""}`;
          const styleClass = isLatest
            ? "border-grad-peach bg-surface-strong"
            : isAnalyzed
            ? "bg-surface-strong"
            : "bg-canvas-soft";
          return (
            <div
              key={kf.shot_id}
              ref={isLatest ? latestCellRef : null}
              data-testid="kf-cell"
              className={`cell ${stateClass} ${CELL_BASE} ${styleClass}`}
            >
              {isAnalyzed && (
                <img
                  src={`/api/frames/${youtubeId}/${kf.shot_id}`}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <span
                className={`absolute bottom-1 left-1 px-1 py-px font-sans text-[10px] uppercase tracking-[0.8px] rounded-sm bg-black/60 ${
                  isAnalyzed ? "text-body" : "text-muted"
                }`}
              >
                {formatTimecode(kf.timestamp_s)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
