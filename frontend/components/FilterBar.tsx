"use client";
import type { Confidence } from "@/lib/types";

const CHIP_BASE =
  "inline-flex items-center gap-2 px-3 py-[5px] rounded-full border font-sans text-[12px] font-semibold uppercase tracking-uc cursor-pointer select-none transition-[opacity,color,background] duration-200 hover:opacity-100";

const CHIP_OFF =
  "bg-transparent border-hairline text-muted opacity-55";

const CHIP_VARIANT: Record<Confidence | "default", string> = {
  confirmed:
    "bg-[color:color-mix(in_oklab,var(--grad-peach)_18%,var(--surface-strong))] border-[color:color-mix(in_oklab,var(--grad-peach)_30%,transparent)] text-grad-peach",
  speculative:
    "bg-[color:color-mix(in_oklab,var(--grad-sky)_16%,var(--surface-strong))] border-[color:color-mix(in_oklab,var(--grad-sky)_30%,transparent)] text-grad-sky",
  hidden: "bg-surface-strong border-hairline text-muted",
  default: "bg-surface-strong border-hairline text-body",
};

const VERDICTS: { key: Confidence; label: string }[] = [
  { key: "confirmed", label: "Confirmed" },
  { key: "speculative", label: "Speculative" },
  { key: "hidden", label: "Hidden" },
];

export interface FilterBarProps {
  verdictCounts: Record<Confidence, number>;
  typeCounts: Record<string, number>;
  availableTypes: string[];
  selectedVerdicts: Set<Confidence>;
  selectedTypes: Set<string>;
  onToggleVerdict: (v: Confidence) => void;
  onToggleType: (t: string) => void;
}

export function FilterBar({
  verdictCounts,
  typeCounts,
  availableTypes,
  selectedVerdicts,
  selectedTypes,
  onToggleVerdict,
  onToggleType,
}: FilterBarProps) {
  return (
    <div className="relative z-[1] flex justify-between items-center flex-wrap gap-4 px-[clamp(32px,5vw,64px)] py-4 border-y border-hairline">
      <div className="flex flex-wrap items-center gap-2">
        {VERDICTS.map((v) => {
          const on = selectedVerdicts.has(v.key);
          return (
            <button
              key={v.key}
              type="button"
              aria-pressed={on}
              onClick={() => onToggleVerdict(v.key)}
              className={`${CHIP_BASE} ${on ? CHIP_VARIANT[v.key] : CHIP_OFF}`}
            >
              <span className="text-ink font-bold">{verdictCounts[v.key] ?? 0}</span> {v.label}
            </button>
          );
        })}
        <span className="inline-block w-px h-[18px] mx-2 bg-hairline" />
        {availableTypes.map((t) => {
          const on = selectedTypes.has(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => onToggleType(t)}
              className={`${CHIP_BASE} ${on ? CHIP_VARIANT.default : CHIP_OFF}`}
            >
              <span className="text-ink font-bold">{typeCounts[t] ?? 0}</span> {t}
            </button>
          );
        })}
      </div>
      <div className="font-sans text-[12px] text-muted">
        <span className="font-sans text-[12px] font-semibold uppercase tracking-uc text-muted">Sort · timecode ↑</span>
      </div>
    </div>
  );
}
