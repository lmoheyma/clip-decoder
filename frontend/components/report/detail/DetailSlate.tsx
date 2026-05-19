"use client";
import Link from "next/link";
import type { VerifiedReference } from "@/lib/types";
import { BrandLink } from "@/components/BrandLink";

const NAV_LINK =
  "font-mono text-[11px] uppercase tracking-[0.14em] text-body no-underline px-2.5 py-1 rounded-full border border-hairline-soft transition-colors duration-200 hover:text-ink hover:border-hairline-strong";

const NAV_LINK_DISABLED =
  "font-mono text-[11px] uppercase tracking-[0.14em] text-muted-soft no-underline px-2.5 py-1 rounded-full border border-hairline-soft cursor-not-allowed pointer-events-none";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

export function DetailSlate({
  youtubeId,
  reference,
  index,
  total,
}: {
  youtubeId: string;
  reference: VerifiedReference;
  index: number;
  total: number;
}) {
  const prevDisabled = index <= 0;
  const nextDisabled = index >= total - 1;
  const tc = formatTimecode(reference.timestamp_s);
  const shotId = reference.source_frame_id.toUpperCase();
  const reportHref = `/report/${youtubeId}`;
  return (
    <div className="slate detail-slate relative z-[2] flex items-center gap-[18px] px-[clamp(28px,4vw,56px)] py-[22px] max-sm:px-5 max-sm:py-[14px] max-sm:gap-3 font-sans text-sm text-body tracking-[0.14px]">
      <BrandLink />
      <span className="max-sm:hidden font-sans text-[11px] uppercase tracking-[0.14em] text-body pl-[18px] ml-1.5 border-l border-hairline-soft">
        Focus · {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </span>
      <span className="flex-1 h-px" />
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-body">{tc} · {shotId}</span>
      <span className="inline-flex items-center gap-1.5 ml-4">
        {prevDisabled ? (
          <span className={NAV_LINK_DISABLED} aria-disabled="true">← PREV</span>
        ) : (
          <Link className={NAV_LINK} href={`/report/${youtubeId}/ref/${index - 1}`}>← PREV</Link>
        )}
        {nextDisabled ? (
          <span className={NAV_LINK_DISABLED} aria-disabled="true">NEXT →</span>
        ) : (
          <Link className={NAV_LINK} href={`/report/${youtubeId}/ref/${index + 1}`}>NEXT →</Link>
        )}
        <Link className={NAV_LINK} href={reportHref}>ESC</Link>
      </span>
    </div>
  );
}
