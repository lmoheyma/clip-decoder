"use client";
import type { PipelineEvent } from "@/lib/types";
import { classifySteps } from "@/lib/pipelineStats";

export function PipelineList({ events }: { events: PipelineEvent[] }) {
  const steps = classifySteps(events);
  return (
    <div className="pipeline-list">
      {steps.map((s, i) => (
        <div
          key={s.key}
          className={`pipeline-row ${s.status === "done" ? "done" : ""} ${s.status === "active" ? "active" : ""} ${s.status === "error" ? "error" : ""}`}
        >
          <span className="pill">
            <span className="num">{String(i + 1).padStart(2, "0")}</span>
            <em>{s.label}</em>
          </span>
          <span className="progress">
            <i style={{ width: `${s.progress * 100}%` }} />
          </span>
          <span className="frac">{s.fraction}</span>
        </div>
      ))}
    </div>
  );
}
