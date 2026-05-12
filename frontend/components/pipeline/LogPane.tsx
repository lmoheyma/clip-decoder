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
      lines.push({
        t,
        lvl: "shots",
        text: `→ ${p.shot_count ?? 0} boundaries · keyframes capped at 80`,
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
    } else if (e.step === "error") {
      lines.push({ t, lvl: "error", text: e.message, isError: true });
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
    <div className="log-pane">
      <h3>
        <span className="live">Live log — NIM stream</span>
        <span>tail · auto-scroll</span>
      </h3>
      <div className="log" ref={logRef}>
        {lines.length === 0 ? (
          <div>
            <span className="lvl">log</span>
            <span className="v">Awaiting first event…</span>
          </div>
        ) : (
          lines.map((line, i) => (
            <div key={i}>
              <span className="t">{line.t}</span>
              <span
                className={`lvl ${line.isCandidate ? "candidate" : ""} ${line.isError ? "error" : ""}`}
              >
                {line.lvl}
              </span>
              {line.text && <span className="v">{line.text}</span>}
              {line.quote && <span className="q">{line.quote}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
