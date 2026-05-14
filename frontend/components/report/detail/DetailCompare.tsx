"use client";
import { useEffect, useRef } from "react";
import type { FrameAnalysis, VerifiedReference } from "@/lib/types";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";

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
    // Seek every time the timestamp changes (prev/next navigation
    // re-renders this component without remounting the iframe).
    playerRef.current?.seekTo(reference.timestamp_s);
  }, [reference.timestamp_s]);

  // Right-pane sub line: join only the non-null metadata fields with " · ".
  const rightSubParts = [
    reference.work_creator,
    reference.work_year !== null ? String(reference.work_year) : null,
    reference.medium,
    reference.institution,
  ].filter((x): x is string => Boolean(x));

  return (
    <div className="detail-compare">
      <div className="detail-pane">
        <div className="img">
          <VideoPlayer
            ref={playerRef}
            youtubeId={youtubeId}
            startSeconds={reference.timestamp_s}
          />
        </div>
        <div className="body">
          <div className="lbl">From the clip · {tc} · {shotId}</div>
          <div className="ttl">
            Frame {String(frameIndex).padStart(3, "0")}
            {compositionShort ? ` — ${compositionShort}` : ""}
          </div>
          {frame && (
            <div className="sub">
              Camera {frame.camera_move} ·{" "}
              {truncate(frame.costume_setting, 60) || "indeterminate setting"}
            </div>
          )}
        </div>
      </div>

      <div className={`detail-pane ${reference.wikipedia_thumbnail_url ? "" : "placeholder"}`}>
        <div className="img">
          {reference.wikipedia_thumbnail_url ? (
            <img
              src={reference.wikipedia_thumbnail_url}
              alt={reference.work_title}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <>Reference image · drop here</>
          )}
        </div>
        <div className="body">
          <div className="lbl">Reference work</div>
          <div className="ttl serif-it">{reference.work_title}</div>
          <div className="sub" data-testid="detail-compare-sub">
            {rightSubParts.join(" · ")}
          </div>
        </div>
      </div>
    </div>
  );
}
