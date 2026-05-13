"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchReport, subscribePipeline } from "@/lib/api";
import type { PipelineEvent, Report } from "@/lib/types";
import { PipelinePage } from "@/components/pipeline/PipelinePage";
import { ReportContent } from "@/components/report/ReportContent";

export default function Page() {
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
        (msg) => !cancelled && setError(msg),
      );
    }
    void load();
    return () => {
      cancelled = true;
      close?.();
    };
  }, [id]);

  if (report) return <ReportContent report={report} youtubeId={id} />;
  return <PipelinePage youtubeId={id} events={events} error={error} />;
}
