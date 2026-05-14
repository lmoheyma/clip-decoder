"use client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export interface VideoPlayerHandle {
  seekTo: (timestampS: number) => void;
}

const YT_ORIGIN = "https://www.youtube-nocookie.com";

export const VideoPlayer = forwardRef<
  VideoPlayerHandle,
  { youtubeId: string; startSeconds?: number }
>(function VideoPlayer({ youtubeId, startSeconds }, ref) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Origin must match the parent page exactly for the YT IFrame API to
  // accept commands; computed client-side to avoid SSR/CSR mismatch.
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useImperativeHandle(ref, () => ({
    seekTo(t: number) {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      win.postMessage(
        JSON.stringify({
          event: "command",
          func: "seekTo",
          args: [t, true],
        }),
        YT_ORIGIN,
      );
    },
  }));

  // YouTube's embed URL accepts a `start=N` param (integer seconds). Baking
  // it into the src parks the player at that timestamp on initial load —
  // necessary because the parent's seekTo() fires before the iframe is
  // actually rendered (origin gating + lazy mount). The seekTo handle is
  // still used for subsequent prev/next navigation while the iframe stays
  // mounted across re-renders.
  //
  // Snapshot the initial startSeconds so the iframe `src` is set at mount
  // and never mutates afterwards. Subsequent seeks come through the seekTo
  // handle via postMessage — that keeps the iframe alive across re-renders
  // and avoids a full YouTube reinit on prev/next navigation.
  const initialStart = useRef(startSeconds).current;
  const start = typeof initialStart === "number" && Number.isFinite(initialStart)
    ? `&start=${Math.floor(initialStart)}`
    : "";

  return (
    <div
      className="player"
      style={{
        aspectRatio: "16/9",
        width: "100%",
        background: "var(--surface-dark)",
        borderRadius: "var(--r-2)",
        overflow: "hidden",
        boxShadow: "var(--shadow-1)",
      }}
    >
      {origin && (
        <iframe
          ref={iframeRef}
          title="YouTube video player"
          src={`${YT_ORIGIN}/embed/${encodeURIComponent(youtubeId)}?enablejsapi=1&playsinline=1&rel=0&modestbranding=1&origin=${encodeURIComponent(origin)}${start}`}
          width="100%"
          height="100%"
          allow="accelerometer; autoplay; clipboard-write; compute-pressure; encrypted-media; gyroscope; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      )}
    </div>
  );
});
