"use client";
import {
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import ReactPlayer from "react-player";

export interface VideoPlayerHandle {
  seekTo: (timestampS: number) => void;
}

export const VideoPlayer = forwardRef<
  VideoPlayerHandle,
  { youtubeId: string }
>(function VideoPlayer({ youtubeId }, ref) {
  const playerRef = useRef<ReactPlayer | null>(null);

  useImperativeHandle(ref, () => ({
    seekTo: (t: number) => playerRef.current?.seekTo(t, "seconds"),
  }));

  return (
    <div className="aspect-video w-full bg-black rounded-comfy overflow-hidden shadow-midnight">
      <ReactPlayer
        ref={(p) => { playerRef.current = p; }}
        url={`https://www.youtube.com/watch?v=${youtubeId}`}
        width="100%"
        height="100%"
        controls
      />
    </div>
  );
});
