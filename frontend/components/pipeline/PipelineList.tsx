"use client";
import type { PipelineEvent } from "@/lib/types";
import { classifySteps } from "@/lib/pipelineStats";

const PROGRESS_TRACK_BASE =
  "relative flex-1 h-0.5 rounded-full overflow-hidden";

const PROGRESS_TRACK: Record<string, string> = {
  active: "bg-[color:color-mix(in_oklab,var(--grad-peach)_18%,var(--hairline))]",
  done: "bg-hairline",
  error: "bg-hairline",
  default: "bg-hairline",
};

const PROGRESS_FILL: Record<string, string> = {
  active:
    "bg-[linear-gradient(90deg,transparent_0%,var(--grad-peach)_50%,transparent_100%)] bg-[length:200%_100%] animate-[stage-sweep_1.4s_linear_infinite] min-w-[28%]",
  done: "bg-body",
  error: "bg-error",
  default: "bg-ink",
};

const FRAC: Record<string, string> = {
  active: "text-grad-peach animate-[stage-fade_1.6s_ease-in-out_infinite]",
  done: "text-muted",
  error: "text-body",
  default: "text-body",
};

const PILL_NUM: Record<string, string> = {
  active: "text-grad-peach",
  done: "text-muted",
  error: "text-muted",
  default: "text-muted-soft",
};

const PILL_EM: Record<string, string> = {
  active: "text-ink",
  done: "text-ink",
  error: "text-ink",
  default: "text-muted",
};

export function PipelineList({ events }: { events: PipelineEvent[] }) {
  const steps = classifySteps(events);
  return (
    <div className="rounded-2 border border-hairline bg-canvas-soft px-4 py-1">
      {steps.map((s, i) => {
        const status = s.status;
        return (
          <div
            key={s.key}
            className="flex items-center gap-5 py-4 font-sans text-[15px] text-ink border-b border-hairline last:border-b-0"
          >
            <span className="inline-flex items-center gap-3 w-[180px] font-medium text-ink">
              <span
                className={`w-6 font-sans text-[12px] font-semibold uppercase tracking-uc ${PILL_NUM[status] ?? PILL_NUM.default}`}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <em className={`not-italic ${PILL_EM[status] ?? PILL_EM.default}`}>{s.label}</em>
            </span>
            <span className={`${PROGRESS_TRACK_BASE} ${PROGRESS_TRACK[status] ?? PROGRESS_TRACK.default}`}>
              <i
                className={`block h-full rounded-full ${PROGRESS_FILL[status] ?? PROGRESS_FILL.default}`}
                style={{ width: `${s.progress * 100}%` }}
              />
            </span>
            <span
              className={`min-w-[90px] text-right font-sans text-[13px] font-medium ${FRAC[status] ?? FRAC.default}`}
            >
              {s.fraction}
            </span>
          </div>
        );
      })}
    </div>
  );
}
