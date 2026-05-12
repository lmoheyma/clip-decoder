"use client";
import type { VisionFramePayload } from "@/lib/types";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  const minutes = Math.floor(t / 60);
  const seconds = t % 60;
  const ms = Math.floor((s - t) * 1000);
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

export function NowFrame({
  frame,
  youtubeId,
}: {
  frame: VisionFramePayload | null;
  youtubeId: string;
}) {
  if (!frame) {
    return (
      <div className="now vignette">
        <div className="label">VISION · AWAITING FIRST FRAME</div>
      </div>
    );
  }
  return (
    <div>
      <div className="now vignette">
        <img
          src={`/api/frames/${youtubeId}/${frame.frame_id}`}
          alt=""
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div className="scan" />
        <div className="crosshair">
          <svg width="48" height="48" viewBox="0 0 48 48">
            <line x1="0" y1="24" x2="48" y2="24" stroke="white" strokeWidth="0.5" />
            <line x1="24" y1="0" x2="24" y2="48" stroke="white" strokeWidth="0.5" />
            <circle cx="24" cy="24" r="12" stroke="white" strokeWidth="0.5" fill="none" />
          </svg>
        </div>
        <div className="label">
          VISION · FRAME {frame.shot_index.toString().padStart(3, "0")} / {frame.total_shots.toString().padStart(3, "0")}
        </div>
        <div className="meta-overlay">
          <span>{formatTimecode(frame.timestamp_s)}</span>
          <span>
            {frame.frame_id.toUpperCase()}
            {frame.composition ? ` · ${frame.composition.toUpperCase()}` : ""}
          </span>
        </div>
      </div>
      {frame.palette_hex && frame.palette_hex.length > 0 && (
        <div className="now-palette">
          {frame.palette_hex.map((hex, i) => (
            <span key={i} style={{ background: hex }} />
          ))}
        </div>
      )}
    </div>
  );
}
