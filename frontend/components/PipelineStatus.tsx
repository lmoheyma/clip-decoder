"use client";
import type { PipelineEvent, PipelineStep } from "@/lib/types";

type Step = { key: PipelineStep; label: string; floor: number; ceiling: number };

// Step boundaries mirror what the orchestrator emits in
// backend/app/pipeline/orchestrator.py — keep these in sync.
const STEPS: Step[] = [
  { key: "ingest",   label: "INGEST",    floor: 0.00, ceiling: 0.10 },
  { key: "shots",    label: "SHOTS",     floor: 0.10, ceiling: 0.20 },
  { key: "vision",   label: "VISION",    floor: 0.20, ceiling: 0.55 },
  { key: "crossref", label: "CROSS-REF", floor: 0.55, ceiling: 0.70 },
  { key: "verify",   label: "VERIFY",    floor: 0.70, ceiling: 1.00 },
];

type Status = "queued" | "active" | "done";

function classify(events: PipelineEvent[]): {
  perStep: Record<PipelineStep, Status>;
  overall: number;
  active: PipelineStep | null;
  failed: boolean;
  finished: boolean;
} {
  const seen = new Set(events.map((e) => e.step));
  const finished = seen.has("done");
  const failed = seen.has("error");
  const overall = events.length
    ? Math.max(...events.map((e) => e.progress ?? 0))
    : 0;

  const perStep: Record<PipelineStep, Status> = {
    ingest: "queued", shots: "queued", vision: "queued",
    crossref: "queued", verify: "queued", done: "queued", error: "queued",
  };

  for (const s of STEPS) {
    if (overall >= s.ceiling - 1e-6) perStep[s.key] = "done";
    else if (overall > s.floor) perStep[s.key] = "active";
    else if (seen.has(s.key)) perStep[s.key] = "active";
  }
  if (finished) for (const s of STEPS) perStep[s.key] = "done";

  let active: PipelineStep | null = null;
  for (const s of STEPS) {
    if (perStep[s.key] === "active") { active = s.key; break; }
  }
  if (!active && !finished && !failed) {
    // Fall back to the first non-done step
    for (const s of STEPS) {
      if (perStep[s.key] !== "done") { active = s.key; break; }
    }
  }

  return { perStep, overall, active, failed, finished };
}

function StepFill({ step, overall }: { step: Step; overall: number }) {
  const span = step.ceiling - step.floor;
  const local = Math.min(1, Math.max(0, (overall - step.floor) / span));
  return (
    <div className="relative h-[3px] w-full bg-white/10 rounded-sharp overflow-hidden">
      <div
        className="absolute inset-y-0 left-0 fill-aurora"
        style={{ width: `${local * 100}%`, transition: "width 600ms ease-out" }}
      />
    </div>
  );
}

export function PipelineStatus({ events }: { events: PipelineEvent[] }) {
  const { perStep, overall, active, failed, finished } = classify(events);
  const latest = events[events.length - 1];
  const overallPct = Math.round(overall * 100);

  return (
    <section className="w-full max-w-5xl">
      {/* Header ────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-6 mb-8">
        <div>
          <p className="font-mono uppercase text-[11px] tracking-mono-label text-white/55">
            Live pipeline · streaming over SSE
          </p>
          <h2 className="font-display tracking-h2 text-[40px] leading-[1.05] mt-2">
            {failed
              ? "Pipeline halted."
              : finished
              ? "Decode complete."
              : "Decoding in progress."}
          </h2>
        </div>

        {/* Overall progress radial */}
        <ProgressRadial pct={overallPct} state={failed ? "error" : finished ? "done" : "active"} />
      </div>

      {/* Step constellation ────────────────────────────────────── */}
      <div className="relative grid grid-cols-5 gap-3 mb-10">
        {/* Connecting line beneath all steps */}
        <div className="absolute left-0 right-0 top-[14px] h-px bg-white/10" />
        <div
          className="absolute left-0 top-[14px] h-px fill-aurora"
          style={{
            width: `${Math.min(100, overallPct)}%`,
            transition: "width 700ms ease-out",
          }}
        />

        {STEPS.map((s) => {
          const status = perStep[s.key];
          const isActive = active === s.key && !finished && !failed;
          return (
            <div key={s.key} className="flex flex-col gap-3">
              <div className="flex items-center gap-2 relative">
                <span
                  data-active={status !== "queued"}
                  className={[
                    "block w-[10px] h-[10px] rounded-full relative",
                    status === "done" && "bg-lavender",
                    status === "active" && "bg-[#ef2cc1] step-glow",
                    status === "queued" && "bg-white/15",
                  ].filter(Boolean).join(" ")}
                />
                <span
                  data-active={status !== "queued"}
                  className={[
                    "font-mono uppercase text-[11px] tracking-mono-label",
                    status === "done" && "text-white",
                    status === "active" && "text-white",
                    status === "queued" && "text-white/35",
                  ].filter(Boolean).join(" ")}
                >
                  {s.label}
                </span>
              </div>

              <StepFill step={s} overall={overall} />

              <p
                className={[
                  "font-mono uppercase text-[10px] tracking-mono-label leading-[1.4] min-h-[28px]",
                  status === "done" && "text-white/55",
                  status === "active" && "text-white/85",
                  status === "queued" && "text-white/25",
                ].filter(Boolean).join(" ")}
              >
                {isActive ? "Working…" : status === "done" ? "Done" : "Queued"}
              </p>
            </div>
          );
        })}
      </div>

      {/* Live message terminal ─────────────────────────────────── */}
      <div className="relative glass-dark rounded-comfy p-6 overflow-hidden">
        {/* Decorative top scan line */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px fill-aurora"
        />
        <div className="flex items-baseline justify-between mb-3">
          <span className="font-mono uppercase text-[10px] tracking-mono-label text-white/45">
            // last event
          </span>
          {latest && (
            <span className="font-mono uppercase text-[10px] tracking-mono-label text-white/45">
              step={latest.step} · progress={(latest.progress * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <p
          className={[
            "font-display text-[24px] leading-[1.2] tracking-h3 min-h-[32px]",
            !finished && !failed && "caret",
          ].filter(Boolean).join(" ")}
          aria-live="polite"
        >
          {failed
            ? latest?.message ?? "Pipeline failed"
            : finished
            ? latest?.message ?? "Done."
            : latest?.message ?? "Establishing stream…"}
        </p>
      </div>

      {/* Event log — prior events only (latest is shown above) */}
      {events.length > 1 && (
        <ul className="mt-8 grid gap-1 font-mono uppercase text-[10px] tracking-mono-label text-white/40">
          {events.slice(-7, -1).map((e, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="block w-1 h-1 rounded-full bg-white/30" />
              <span className="text-white/65">{e.step}</span>
              <span className="text-white/25">·</span>
              <span className="truncate">{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProgressRadial({ pct, state }: {
  pct: number;
  state: "active" | "done" | "error";
}) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <div className="relative w-[100px] h-[100px] shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <defs>
          <linearGradient id="aur" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"  stopColor="#ef2cc1" />
            <stop offset="50%" stopColor="#bdbbff" />
            <stop offset="100%" stopColor="#fc4c02" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} stroke="rgba(255,255,255,0.10)" strokeWidth="6" fill="none" />
        <circle
          cx="50" cy="50" r={r}
          stroke={state === "error" ? "#fc4c02" : "url(#aur)"}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          style={{ transition: "stroke-dasharray 700ms ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display tracking-h3 text-[22px] leading-none">
          {pct}%
        </span>
        <span className="font-mono uppercase text-[9px] tracking-mono-label text-white/55 mt-1">
          {state === "error" ? "halted" : state === "done" ? "ready" : "running"}
        </span>
      </div>
    </div>
  );
}
