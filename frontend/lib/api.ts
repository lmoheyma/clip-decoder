import type { PipelineEvent, Report } from "./types";

export interface StartAnalysisResponse {
  youtube_id: string;
  status: "running" | "cached";
  status_stream_url?: string;
}

export async function startAnalysis(
  url: string,
  refresh = false,
): Promise<StartAnalysisResponse> {
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, refresh }),
  });
  if (!r.ok) throw new Error(`analyze failed: ${r.status}`);
  return (await r.json()) as StartAnalysisResponse;
}

export async function fetchReport(youtubeId: string): Promise<Report | null> {
  const r = await fetch(`/api/report/${encodeURIComponent(youtubeId)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`report failed: ${r.status}`);
  return (await r.json()) as Report;
}

export async function flagReference(
  youtubeId: string,
  refIndex: number,
  reason?: string,
): Promise<void> {
  const r = await fetch(`/api/report/${encodeURIComponent(youtubeId)}/flag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref_index: refIndex, reason }),
  });
  if (!r.ok) throw new Error(`flag failed: ${r.status}`);
}

export function subscribePipeline(
  youtubeId: string,
  onEvent: (e: PipelineEvent) => void,
  onError?: (err: unknown) => void,
): () => void {
  const es = new EventSource(`/api/stream/${encodeURIComponent(youtubeId)}`);
  const stepNames: PipelineEvent["step"][] = [
    "ingest", "shots", "vision", "crossref", "verify", "done", "error",
  ];
  for (const step of stepNames) {
    es.addEventListener(step, (raw) => {
      try {
        const data = JSON.parse((raw as MessageEvent).data) as PipelineEvent;
        onEvent(data);
        if (data.step === "done" || data.step === "error") es.close();
      } catch (err) {
        onError?.(err);
      }
    });
  }
  es.onerror = (err) => onError?.(err);
  return () => es.close();
}
