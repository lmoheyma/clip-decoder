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
  { youtubeId: string }
>(function VideoPlayer({ youtubeId }, ref) {
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
          src={`${YT_ORIGIN}/embed/${encodeURIComponent(youtubeId)}?enablejsapi=1&playsinline=1&rel=0&modestbranding=1&origin=${encodeURIComponent(origin)}`}
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
