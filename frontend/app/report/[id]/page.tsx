"use client";
import { useEffect, useState } from "react";
import { useParams, notFound } from "next/navigation";
import { fetchReport, fetchStatus, subscribePipeline } from "@/lib/api";
import type { PipelineEvent, Report } from "@/lib/types";
import { PipelinePage } from "@/components/pipeline/PipelinePage";
import { ReportContent } from "@/components/report/ReportContent";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let close: (() => void) | undefined;

    async function load() {
      // Probe status first so a missing record renders 404 instead of
      // falling through to a perpetually-pending pipeline subscription.
      const { status, error: dbError } = await fetchStatus(id);
      if (cancelled) return;
      if (status === "not_found") {
        setMissing(true);
        setReady(true);
        return;
      }
      if (status === "done") {
        const r = await fetchReport(id);
        if (!cancelled) {
          setReport(r);
          setReady(true);
        }
        return;
      }
      if (status === "error") {
        setError(dbError ?? "Pipeline failed.");
        setReady(true);
        return;
      }
      // pending | running — subscribe to the live SSE stream.
      setReady(true);
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

  if (missing) notFound();
  if (!ready) return null;
  if (report) return <ReportContent report={report} youtubeId={id} />;
  return <PipelinePage youtubeId={id} events={events} error={error} />;
}
