"use client";
import Link from "next/link";
import type { VerifiedReference } from "@/lib/types";

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
    <div className="slate detail-slate">
      <span className="dot" />
      <b>FOCUS · REFERENCE {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</b>
      <span className="sep" />
      <span className="tc">{tc} · {shotId}</span>
      <span className="sep" />
      {prevDisabled ? (
        <span className="nav-link disabled" aria-disabled="true">← PREV</span>
      ) : (
        <Link className="nav-link" href={`/report/${youtubeId}/ref/${index - 1}`}>← PREV</Link>
      )}
      {nextDisabled ? (
        <span className="nav-link disabled" aria-disabled="true">NEXT →</span>
      ) : (
        <Link className="nav-link" href={`/report/${youtubeId}/ref/${index + 1}`}>NEXT →</Link>
      )}
      <Link className="nav-link" href={reportHref}>ESC</Link>
    </div>
  );
}
