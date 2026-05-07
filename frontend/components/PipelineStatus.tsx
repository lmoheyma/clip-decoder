import type { PipelineEvent, PipelineStep } from "@/lib/types";

const STEPS: { key: PipelineStep; label: string }[] = [
  { key: "ingest", label: "INGEST" },
  { key: "shots", label: "SHOTS" },
  { key: "vision", label: "VISION" },
  { key: "crossref", label: "CROSS-REF" },
  { key: "verify", label: "VERIFY" },
];

export function PipelineStatus({ events }: { events: PipelineEvent[] }) {
  const seen = new Set(events.map((e) => e.step));
  const latest = events[events.length - 1];
  return (
    <div className="w-full max-w-3xl flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {STEPS.map((s) => {
          const active = seen.has(s.key);
          return (
            <span
              key={s.key}
              data-active={active}
              className={`font-mono uppercase text-[11px] tracking-mono-label px-3 py-2 rounded-sharp border ${
                active
                  ? "border-midnight bg-midnight text-white"
                  : "border-black/10 bg-white text-black/40"
              }`}
            >
              {s.label}
            </span>
          );
        })}
      </div>
      {latest && (
        <p className="text-[16px] tracking-body text-black/60">
          {latest.message}
        </p>
      )}
    </div>
  );
}
