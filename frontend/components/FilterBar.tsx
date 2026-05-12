"use client";
import type { Confidence } from "@/lib/types";

const VERDICTS: { key: Confidence; label: string; chipClass: string }[] = [
  { key: "confirmed", label: "Confirmed", chipClass: "chip-amber" },
  { key: "speculative", label: "Speculative", chipClass: "chip-cyan" },
  { key: "hidden", label: "Hidden", chipClass: "chip-dim" },
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
    <div className="filter-bar">
      <div className="left">
        {VERDICTS.map((v) => {
          const on = selectedVerdicts.has(v.key);
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => onToggleVerdict(v.key)}
              className={`chip ${v.chipClass} ${on ? "chip-on" : "chip-off"}`}
            >
              <span className="num">{verdictCounts[v.key] ?? 0}</span> {v.label}
            </button>
          );
        })}
        <span className="filter-divider" />
        {availableTypes.map((t) => {
          const on = selectedTypes.has(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => onToggleType(t)}
              className={`chip ${on ? "chip-on" : "chip-off"}`}
            >
              <span className="num">{typeCounts[t] ?? 0}</span> {t}
            </button>
          );
        })}
      </div>
      <div className="right">
        <span className="hairline">Sort · timecode ↑</span>
      </div>
    </div>
  );
}
