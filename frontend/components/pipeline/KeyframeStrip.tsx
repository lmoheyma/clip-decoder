"use client";
import { useEffect, useRef } from "react";

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
    <div className="strip-row">
      <div className="lbl">
        <span>EXTRACTED KEYFRAMES</span>
        <span>
          {analyzedCount} analysed · {pendingCount} pending
        </span>
      </div>
      <div className="strip" ref={stripRef}>
        {keyframes.map((kf) => {
          const isAnalyzed = analyzedIds.has(kf.shot_id);
          const isLatest = kf.shot_id === latestId;
          return (
            <div
              key={kf.shot_id}
              ref={isLatest ? latestCellRef : null}
              data-testid="kf-cell"
              className={`cell ${isAnalyzed ? "analyzed" : "pending"} ${isLatest ? "latest" : ""}`}
            >
              {isAnalyzed && (
                <img
                  src={`/api/frames/${youtubeId}/${kf.shot_id}`}
                  alt=""
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <span className="tc">{formatTimecode(kf.timestamp_s)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
