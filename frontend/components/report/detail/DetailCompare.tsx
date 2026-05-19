"use client";
import { useEffect, useRef } from "react";
import type { FrameAnalysis, VerifiedReference } from "@/lib/types";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";

const PANE_BASE =
  "rounded-2 border border-hairline bg-surface-card overflow-hidden";

const PANE_IMG = "aspect-video bg-black relative overflow-hidden";

const PANE_BODY = "px-[18px] py-3.5";

const PANE_LBL =
  "mb-1.5 font-sans text-[11px] uppercase tracking-uc text-grad-peach";

const PANE_TTL =
  "font-serif text-[18px] leading-[1.2] tracking-[-0.015em] text-ink";

const PANE_SUB = "mt-1 font-serif italic text-[13px] text-body";

const PLACEHOLDER_IMG =
  "aspect-video relative overflow-hidden grid place-items-center font-sans text-[12px] uppercase tracking-uc text-muted bg-[linear-gradient(135deg,#1a1612_0%,#25201b_100%),repeating-linear-gradient(45deg,rgba(255,255,255,0.02)_0_1px,transparent_1px_12px)]";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function truncate(s: string | undefined, max: number): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function DetailCompare({
  reference,
  frame,
  youtubeId,
  frameIndex,
}: {
  reference: VerifiedReference;
  frame: FrameAnalysis | undefined;
  youtubeId: string;
  frameIndex: number;
}) {
  const tc = formatTimecode(reference.timestamp_s);
  const shotId = reference.source_frame_id.toUpperCase();
  const compositionShort = truncate(frame?.composition, 60);

  const playerRef = useRef<VideoPlayerHandle>(null);
  useEffect(() => {
    playerRef.current?.seekTo(reference.timestamp_s);
  }, [reference.timestamp_s]);

  const rightSubParts = [
    reference.work_creator,
    reference.work_year !== null ? String(reference.work_year) : null,
    reference.medium,
    reference.institution,
  ].filter((x): x is string => Boolean(x));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 max-[900px]:grid-cols-1">
      <div className={PANE_BASE}>
        <div className={PANE_IMG}>
          <VideoPlayer
            ref={playerRef}
            youtubeId={youtubeId}
            startSeconds={reference.timestamp_s}
          />
        </div>
        <div className={PANE_BODY}>
          <div className={PANE_LBL}>From the clip · {tc} · {shotId}</div>
          <div className={PANE_TTL}>
            Frame {String(frameIndex).padStart(3, "0")}
            {compositionShort ? ` — ${compositionShort}` : ""}
          </div>
          {frame && (
            <div className={PANE_SUB}>
              Camera {frame.camera_move} ·{" "}
              {truncate(frame.costume_setting, 60) || "indeterminate setting"}
            </div>
          )}
        </div>
      </div>

      <div className={PANE_BASE}>
        {reference.wikipedia_thumbnail_url ? (
          <div className={PANE_IMG}>
            <img
              src={reference.wikipedia_thumbnail_url}
              alt={reference.work_title}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        ) : (
          <div className={PLACEHOLDER_IMG}>Reference image · drop here</div>
        )}
        <div className={PANE_BODY}>
          <div className={PANE_LBL}>Reference work</div>
          <div className={`${PANE_TTL} italic font-light tracking-[-0.01em]`}>
            {reference.work_title}
          </div>
          <div className={PANE_SUB} data-testid="detail-compare-sub">
            {rightSubParts.join(" · ")}
          </div>
        </div>
      </div>
    </div>
  );
}
