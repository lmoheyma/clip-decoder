"use client";
import type { VisionFramePayload } from "@/lib/types";

const NOW_FRAME =
  "relative w-full max-w-[640px] mx-auto aspect-video overflow-hidden rounded-2 bg-surface-strong shadow-[inset_0_0_80px_rgba(0,0,0,0.7)]";

const LABEL =
  "absolute top-3 left-3 px-2.5 py-1 bg-black/60 font-sans text-[11px] uppercase tracking-uc text-ink rounded";

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
      <div className={NOW_FRAME}>
        <div className={LABEL}>VISION · AWAITING FIRST FRAME</div>
      </div>
    );
  }
  return (
    <div>
      <div className={NOW_FRAME}>
        <img
          src={`/api/frames/${youtubeId}/${frame.frame_id}`}
          alt=""
          className="block w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div
          aria-hidden
          className="absolute left-0 right-0 h-px pointer-events-none bg-[linear-gradient(90deg,transparent,var(--grad-peach),transparent)] animate-[scan-down_3s_linear_infinite]"
        />
        <div className="absolute inset-0 flex items-center justify-center opacity-30 pointer-events-none">
          <svg width="48" height="48" viewBox="0 0 48 48">
            <line x1="0" y1="24" x2="48" y2="24" stroke="white" strokeWidth="0.5" />
            <line x1="24" y1="0" x2="24" y2="48" stroke="white" strokeWidth="0.5" />
            <circle cx="24" cy="24" r="12" stroke="white" strokeWidth="0.5" fill="none" />
          </svg>
        </div>
        <div className={LABEL}>
          VISION · FRAME {frame.shot_index.toString().padStart(3, "0")} / {frame.total_shots.toString().padStart(3, "0")}
        </div>
        <div className="absolute bottom-3 left-3 right-3 flex justify-between gap-3 font-sans text-[11px] uppercase tracking-uc text-ink">
          <span className="px-2 py-1 bg-black/60 rounded">{formatTimecode(frame.timestamp_s)}</span>
          <span className="px-2 py-1 bg-black/60 rounded">
            {frame.frame_id.toUpperCase()}
            {frame.composition ? ` · ${frame.composition.toUpperCase()}` : ""}
          </span>
        </div>
      </div>
      {frame.palette_hex && frame.palette_hex.length > 0 && (
        <div className="flex gap-1 h-4 mt-2 max-w-[640px] mx-auto">
          {frame.palette_hex.map((hex, i) => (
            <span key={i} className="flex-1 rounded" style={{ background: hex }} />
          ))}
        </div>
      )}
    </div>
  );
}
