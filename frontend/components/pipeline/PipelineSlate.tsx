"use client";
import { useEffect, useState } from "react";
import { BrandLink } from "@/components/BrandLink";

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
    <div className="slate relative z-[2] flex items-center gap-[18px] px-[clamp(28px,4vw,56px)] py-[22px] max-sm:px-5 max-sm:py-[14px] max-sm:gap-3 font-sans text-sm text-body tracking-[0.14px]">
      <BrandLink />
      <span className="max-sm:hidden font-sans text-[11px] uppercase tracking-[0.14em] text-body pl-[18px] ml-1.5 border-l border-hairline-soft">Analysing</span>
      <span className="flex-1 h-px" />
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-body">{youtubeId}</span>
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted pl-[18px] ml-1.5 border-l border-hairline-soft">
        {startTs ? formatElapsed(startTs) : "00:00:00"}
      </span>
    </div>
  );
}
