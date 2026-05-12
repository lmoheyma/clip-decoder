"use client";
import type { IngestPayload } from "@/lib/types";

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
    <dl className="clip-meta">
      <div>
        <dt>YouTube ID</dt>
        <dd className="mono">{youtubeId}</dd>
      </div>
      <div>
        <dt>Title</dt>
        <dd className="serif">{meta?.title ?? "—"}</dd>
      </div>
      <div>
        <dt>Channel · Duration</dt>
        <dd>
          {meta
            ? `${meta.channel} · ${formatDuration(meta.duration_s)}`
            : "— · —"}
        </dd>
      </div>
      <div>
        <dt>Captions</dt>
        <dd>
          {meta && meta.captions_count > 0
            ? `auto · en (${meta.captions_count} cues)`
            : "none"}
        </dd>
      </div>
    </dl>
  );
}
