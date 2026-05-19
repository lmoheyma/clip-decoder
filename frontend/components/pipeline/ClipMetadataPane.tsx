"use client";
import type { IngestPayload } from "@/lib/types";

const DT = "font-sans text-[11px] font-medium uppercase tracking-uc text-muted";
const DD = "m-0 font-sans text-sm text-body-strong";

function formatDuration(s: number): string {
  const t = Math.floor(s);
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
}

export function ClipMetadataPane({
  meta,
  youtubeId,
}: {
  meta: IngestPayload | null;
  youtubeId: string;
}) {
  return (
    <dl className="m-0 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <dt className={DT}>YouTube ID</dt>
        <dd className={`${DD} tracking-[0.1em]`}>{youtubeId}</dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className={DT}>Title</dt>
        <dd className={`m-0 font-serif italic text-[18px] text-body-strong`}>{meta?.title ?? "—"}</dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className={DT}>Channel · Duration</dt>
        <dd className={DD}>
          {meta
            ? `${meta.channel} · ${formatDuration(meta.duration_s)}`
            : "— · —"}
        </dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className={DT}>Captions</dt>
        <dd className={DD}>
          {meta && meta.captions_count > 0
            ? `auto · en (${meta.captions_count} cues)`
            : "none"}
        </dd>
      </div>
    </dl>
  );
}
