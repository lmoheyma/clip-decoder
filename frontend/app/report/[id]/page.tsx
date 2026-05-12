"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchReport, subscribePipeline } from "@/lib/api";
import type { PipelineEvent, Report } from "@/lib/types";
import { PipelineStatus } from "@/components/PipelineStatus";
import { ReportContent } from "@/components/report/ReportContent";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let close: (() => void) | undefined;

    async function load() {
      const r = await fetchReport(id);
      if (cancelled) return;
      if (r) {
        setReport(r);
        return;
      }
      close = subscribePipeline(
        id,
        async (e) => {
          if (cancelled) return;
          setEvents((prev) => [...prev, e]);
          if (e.step === "done") {
            const fresh = await fetchReport(id);
            if (!cancelled) setReport(fresh);
          }
          if (e.step === "error") setError(e.message);
        },
        (err) => !cancelled && setError(String(err)),
      );
    }
    void load();
    return () => {
      cancelled = true;
      close?.();
    };
  }, [id]);

  if (error) {
    return (
      <main className="frame surface-dark relative min-h-screen flex flex-col">
        <div className="slate">
          <span className="dot" />
          <b>ClipDecoder</b>
          <span className="slate-context">Report</span>
          <span className="sep" />
          <span className="tc">{id}</span>
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

  if (!report) {
    return (
      <main className="frame surface-dark relative min-h-screen flex flex-col">
        <div className="slate">
          <span className="dot" />
          <b>ClipDecoder</b>
          <span className="slate-context">Report</span>
          <span className="sep" />
          <span className="tc">{id}</span>
        </div>
        <div style={{ padding: "clamp(32px, 5vw, 64px)" }}>
          <PipelineStatus events={events} />
        </div>
      </main>
    );
  }

  return <ReportContent report={report} youtubeId={id} />;
}
