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
  onError?: (message: string) => void,
): () => void {
  const es = new EventSource(`/api/stream/${encodeURIComponent(youtubeId)}`);
  // Steps that map to named SSE events emitted by the backend.
  const stepNames: PipelineEvent["step"][] = [
    "ingest",
    "shots",
    "vision",
    "vision_frame",
    "crossref",
    "crossref_candidate",
    "verify",
    "nim_retry",
    "done",
    "error",
  ];
  // Deduplication: on EventSource auto-reconnect the backend replays the
  // full history. Without this Set, every reconnect duplicates log lines
  // and candidate cards in the UI.
  const seen = new Set<string>();
  // After we receive a terminal `done` or `error` event we close the
  // EventSource ourselves — that close() then fires onerror with
  // readyState=CLOSED, which would otherwise clobber the real error
  // message with a generic "connection lost" string. Track that we
  // closed deliberately so onerror can ignore it.
  let terminated = false;
  function eventKey(e: PipelineEvent): string {
    const p = e.payload as Record<string, unknown>;
    const id =
      (p?.frame_id as string | undefined) ??
      (p?.work_title as string | undefined) ??
      (p?.source_frame_id as string | undefined) ??
      e.message;
    return `${e.step}:${id}:${e.progress}`;
  }
  for (const step of stepNames) {
    es.addEventListener(step, (raw) => {
      try {
        const data = JSON.parse((raw as MessageEvent).data) as PipelineEvent;
        const key = eventKey(data);
        if (seen.has(key)) return;
        seen.add(key);
        onEvent(data);
        if (data.step === "done" || data.step === "error") {
          terminated = true;
          es.close();
        }
      } catch (err) {
        onError?.(
          err instanceof Error ? err.message : "Malformed pipeline event",
        );
      }
    });
  }
  // EventSource's onerror fires on transient drops (browser auto-retries)
  // AND on permanent failures. We only surface a user-visible error when
  // the connection is permanently closed — otherwise the browser is just
  // reconnecting and we'd flash bogus errors for routine network blips.
  es.onerror = () => {
    if (terminated) return;
    if (es.readyState === EventSource.CLOSED) {
      onError?.(
        "Connection to the pipeline stream was lost before it finished.",
      );
    }
  };
  return () => {
    terminated = true;
    es.close();
  };
}
