"use client";

export function ConfidenceFilter({
  showSpeculative,
  onToggle,
}: {
  showSpeculative: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={showSpeculative}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <span className="font-mono uppercase text-[11px] tracking-mono-label text-white/60">
        Show speculative
      </span>
    </label>
  );
}
