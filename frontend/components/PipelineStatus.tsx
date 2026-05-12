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
    vision_frame: "queued", crossref: "queued", crossref_candidate: "queued",
    verify: "queued", done: "queued", error: "queued",
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
    <div
      style={{
        position: "relative",
        height: 3,
        width: "100%",
        background: "var(--hairline)",
        borderRadius: "var(--r-pill)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          left: 0,
          width: `${local * 100}%`,
          background: "var(--grad-peach)",
          transition: "width 600ms ease-out",
        }}
      />
    </div>
  );
}

export function PipelineStatus({ events }: { events: PipelineEvent[] }) {
  const { perStep, overall, active, failed, finished } = classify(events);
  const latest = events[events.length - 1];
  const overallPct = Math.round(overall * 100);

  return (
    <section style={{ width: "100%", maxWidth: "64rem" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 24,
          marginBottom: 32,
        }}
      >
        <div>
          <p className="uc">Live pipeline · streaming over SSE</p>
          <h2
            className="serif-it"
            style={{
              fontSize: "clamp(28px, 4vw, 40px)",
              lineHeight: 1.05,
              marginTop: 8,
              color: "var(--ink)",
            }}
          >
            {failed
              ? "Pipeline halted."
              : finished
              ? "Decode complete."
              : "Decoding in progress."}
          </h2>
        </div>

        <ProgressRadial
          pct={overallPct}
          state={failed ? "error" : finished ? "done" : "active"}
        />
      </div>

      {/* Step constellation */}
      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
          marginBottom: 40,
        }}
      >
        {/* Connecting line beneath all steps */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 14,
            height: 1,
            background: "var(--hairline)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 14,
            height: 1,
            background: "var(--grad-peach)",
            width: `${Math.min(100, overallPct)}%`,
            transition: "width 700ms ease-out",
          }}
        />

        {STEPS.map((s) => {
          const status = perStep[s.key];
          const isActive = active === s.key && !finished && !failed;
          const dotColor =
            status === "done"
              ? "var(--grad-lavender)"
              : status === "active"
              ? "var(--grad-peach)"
              : "var(--hairline-strong)";
          const labelColor =
            status === "queued" ? "var(--muted-soft)" : "var(--ink)";
          const statusColor =
            status === "done"
              ? "var(--body)"
              : status === "active"
              ? "var(--ink)"
              : "var(--muted-soft)";
          return (
            <div
              key={s.key}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    display: "block",
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: dotColor,
                    boxShadow: isActive
                      ? `0 0 12px 2px var(--grad-peach)`
                      : undefined,
                  }}
                />
                <span
                  className="uc"
                  data-active={status !== "queued" ? "true" : "false"}
                  style={{ color: labelColor }}
                >
                  {s.label}
                </span>
              </div>

              <StepFill step={s} overall={overall} />

              <p
                className="uc"
                style={{
                  fontSize: 10,
                  color: statusColor,
                  minHeight: 28,
                  lineHeight: 1.4,
                }}
              >
                {isActive ? "Working…" : status === "done" ? "Done" : "Queued"}
              </p>
            </div>
          );
        })}
      </div>

      {/* Live message terminal */}
      <div
        style={{
          position: "relative",
          background: "var(--surface-card)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--r-2)",
          padding: 24,
          overflow: "hidden",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            insetInline: 0,
            top: 0,
            height: 1,
            background: "var(--grad-peach)",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <span className="uc">// last event</span>
          {latest && (
            <span className="uc">
              step={latest.step} · progress=
              {(latest.progress * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <p
          className="serif-it"
          style={{
            fontSize: 22,
            lineHeight: 1.2,
            minHeight: 32,
            color: "var(--ink)",
          }}
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
        <ul
          style={{
            marginTop: 32,
            display: "grid",
            gap: 4,
            listStyle: "none",
            padding: 0,
          }}
        >
          {events.slice(-7, -1).map((e, i) => (
            <li
              key={i}
              className="uc"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                color: "var(--muted-soft)",
              }}
            >
              <span
                style={{
                  display: "block",
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "var(--muted)",
                }}
              />
              <span style={{ color: "var(--body)" }}>{e.step}</span>
              <span style={{ color: "var(--muted-soft)" }}>·</span>
              <span
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {e.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProgressRadial({
  pct,
  state,
}: {
  pct: number;
  state: "active" | "done" | "error";
}) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const strokeColor =
    state === "error"
      ? "var(--error)"
      : state === "done"
      ? "var(--grad-lavender)"
      : "var(--grad-peach)";
  return (
    <div
      style={{
        position: "relative",
        width: 100,
        height: 100,
        flexShrink: 0,
      }}
    >
      <svg
        viewBox="0 0 100 100"
        style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}
      >
        <circle
          cx="50"
          cy="50"
          r={r}
          stroke="var(--hairline)"
          strokeWidth="6"
          fill="none"
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          stroke={strokeColor}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          style={{ transition: "stroke-dasharray 700ms ease-out" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          className="serif-it"
          style={{ fontSize: 22, lineHeight: 1, color: "var(--ink)" }}
        >
          {pct}%
        </span>
        <span className="uc" style={{ marginTop: 4 }}>
          {state === "error"
            ? "halted"
            : state === "done"
            ? "ready"
            : "running"}
        </span>
      </div>
    </div>
  );
}
