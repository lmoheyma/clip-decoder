"use client";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";

function formatElapsed(startTs: number): string {
  const s = Math.floor((Date.now() - startTs) / 1000);
  const hh = Math.floor(s / 3600).toString().padStart(2, "0");
  const mm = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function PipelineSlate({
  youtubeId,
  startTs,
}: {
  youtubeId: string;
  startTs: number | null;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!startTs) return;
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [startTs]);

  return (
    <div className="slate">
      <BrandMark />
      <b>ClipDecoder</b>
      <span className="slate-context">Analysing</span>
      <span className="sep" />
      <span className="slate-tc">{youtubeId}</span>
      <span className="slate-tc slate-tc-mute">
        {startTs ? formatElapsed(startTs) : "00:00:00"}
      </span>
    </div>
  );
}
