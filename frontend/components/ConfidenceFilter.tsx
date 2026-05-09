"use client";

export function ConfidenceFilter({
  showSpeculative,
  onToggle,
}: {
  showSpeculative: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none group">
      <span className="font-mono uppercase text-[10px] tracking-mono-label text-white/55 group-hover:text-white transition-colors">
        Show speculative
      </span>
      <span className="relative inline-block">
        <input
          type="checkbox"
          checked={showSpeculative}
          onChange={(e) => onToggle(e.target.checked)}
          className="sr-only"
          aria-label="Show speculative references"
        />
        <span
          aria-hidden
          className={[
            "block w-9 h-[18px] rounded-sharp border transition-all",
            showSpeculative
              ? "bg-lavender/20 border-lavender/60"
              : "bg-white/5 border-white/15",
          ].join(" ")}
        />
        <span
          aria-hidden
          className={[
            "absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-sharp transition-all",
            showSpeculative
              ? "translate-x-[18px] bg-lavender"
              : "translate-x-0 bg-white/45",
          ].join(" ")}
        />
      </span>
    </label>
  );
}
