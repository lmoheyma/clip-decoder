"use client";
import { useEffect, useRef } from "react";
import type { PipelineEvent } from "@/lib/types";

interface LogLine {
  t: string;
  lvl: string;
  text?: string;
  quote?: string;
  flag?: string;
  isError?: boolean;
  isCandidate?: boolean;
}

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}
function pad3(n: number) {
  return n.toString().padStart(3, "0");
}

function formatT(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
}

export function buildLogLines(events: PipelineEvent[]): LogLine[] {
  const startTs = Date.now() - events.length * 50;
  const lines: LogLine[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const t = formatT(startTs + i * 50);
    if (e.step === "ingest") {
      const p = e.payload as { title?: string; duration_s?: number };
      lines.push({
        t,
        lvl: "ingest",
        text: "→ ok",
        quote: p.title ? `"${p.title} · ${p.duration_s ?? "?"}s"` : undefined,
      });
    } else if (e.step === "shots") {
      const p = e.payload as { shot_count?: number };
      // Early "Detecting scenes…" emit has no shot_count yet — surface the
      // event message instead so the log shows progress during sampling.
      lines.push({
        t,
        lvl: "shots",
        text:
          typeof p.shot_count === "number"
            ? `→ ${p.shot_count} boundaries · keyframes capped at 80`
            : e.message,
      });
    } else if (e.step === "vision_frame") {
      const p = e.payload as { frame_id: string; raw_description: string };
      lines.push({
        t,
        lvl: "vision",
        text: p.frame_id,
        quote: `"${p.raw_description.slice(0, 70)}${p.raw_description.length > 70 ? "…" : ""}"`,
      });
    } else if (e.step === "crossref_candidate") {
      const p = e.payload as { work_title: string; work_creator: string };
      lines.push({
        t,
        lvl: "candidate",
        text: `→ ${p.work_title} / ${p.work_creator}`,
        isCandidate: true,
      });
    } else if (e.step === "crossref") {
      lines.push({ t, lvl: "crossref", text: e.message });
    } else if (e.step === "verify") {
      lines.push({ t, lvl: "verify", text: e.message });
    } else if (e.step === "vision" && e.message) {
      lines.push({ t, lvl: "vision", text: e.message });
    } else if (e.step === "nim_retry") {
      lines.push({ t, lvl: "retry", text: e.message });
    } else if (e.step === "error") {
      lines.push({ t, lvl: "error", text: e.message, isError: true });
    } else if (e.step === "done") {
      lines.push({ t, lvl: "done", text: e.message });
    }
  }
  return lines.slice(-30);
}

export function LogPane({ events }: { events: PipelineEvent[] }) {
  const logRef = useRef<HTMLDivElement>(null);
  const lines = buildLogLines(events);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div className="rounded-2 border border-hairline bg-surface-card p-4 font-sans text-[12px]">
      <h3 className="flex justify-between items-center m-0 mb-3 font-sans text-[11px] font-medium uppercase tracking-uc text-muted">
        <span className="text-ink">Live log — NIM stream</span>
        <span>tail · auto-scroll</span>
      </h3>
      <div
        ref={logRef}
        className="flex flex-col gap-1 max-h-[200px] overflow-y-auto font-sans text-[12px] leading-[1.5]"
      >
        {lines.length === 0 ? (
          <div className="flex items-baseline gap-2 text-body">
            <span className="shrink-0 min-w-[56px] text-[10px] uppercase tracking-uc text-muted">log</span>
            <span className="text-body">Awaiting first event…</span>
          </div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="flex items-baseline gap-2 text-body">
              <span className="shrink-0 text-muted [font-variant-numeric:tabular-nums]">{line.t}</span>
              <span
                className={`shrink-0 min-w-[56px] text-[10px] uppercase tracking-uc ${
                  line.isCandidate ? "text-grad-peach" : line.isError ? "text-error" : "text-muted"
                }`}
              >
                {line.lvl}
              </span>
              {line.text && <span className="text-body">{line.text}</span>}
              {line.quote && <span className="italic text-body-strong">{line.quote}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
