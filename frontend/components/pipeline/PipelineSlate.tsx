"use client";
import { useEffect, useState } from "react";

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
      <span className="dot" />
      <b>ClipDecoder</b>
      <span className="slate-context">analysing · do not close tab</span>
      <span className="sep" />
      <span className="tc">clip · {youtubeId}</span>
      <span className="tc">
        elapsed {startTs ? formatElapsed(startTs) : "00:00:00"}
      </span>
      <span className="sep" />
    </div>
  );
}
