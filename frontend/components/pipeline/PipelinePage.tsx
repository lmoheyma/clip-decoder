"use client";
import Link from "next/link";
import type { PipelineEvent } from "@/lib/types";
import { PipelineStatus } from "@/components/PipelineStatus";

export function PipelinePage({
  youtubeId,
  events,
  error,
}: {
  youtubeId: string;
  events: PipelineEvent[];
  error: string | null;
}) {
  if (error) {
    return (
      <main className="frame surface-dark relative min-h-screen flex flex-col">
        <div className="slate">
          <span className="dot" />
          <b>ClipDecoder</b>
          <span className="slate-context">Report</span>
          <span className="sep" />
          <span className="tc">{youtubeId}</span>
        </div>
        <div style={{ padding: "clamp(32px, 5vw, 64px)", maxWidth: 720 }}>
          <div
            className="hairline"
            style={{ marginBottom: 16, color: "var(--error)" }}
          >
            Pipeline error
          </div>
          <h1
            className="serif-it"
            style={{
              fontSize: "clamp(28px, 4vw, 48px)",
              color: "var(--ink)",
            }}
            role="alert"
          >
            {error}
          </h1>
          <Link
            className="ulink"
            href="/"
            style={{ marginTop: 24, display: "inline-block" }}
          >
            ← Try another clip
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="frame surface-dark relative min-h-screen flex flex-col">
      <div className="slate">
        <span className="dot" />
        <b>ClipDecoder</b>
        <span className="slate-context">Report</span>
        <span className="sep" />
        <span className="tc">{youtubeId}</span>
      </div>
      <div style={{ padding: "clamp(32px, 5vw, 64px)" }}>
        <PipelineStatus events={events} />
      </div>
    </main>
  );
}
