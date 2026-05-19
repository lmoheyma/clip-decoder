"use client";
import type { ReportStats } from "@/lib/reportStats";

const BREAKDOWN_ROW =
  "flex justify-between items-center font-sans text-sm text-body";
const SWATCH = "inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle";

export function SummaryCard({ stats }: { stats: ReportStats }) {
  const showSources = stats.minYear !== null && stats.maxYear !== null;
  const typeText = stats.typeBreakdown
    .map((t) => `${t.count} ${t.type.toLowerCase()}${t.count > 1 ? "s" : ""}`)
    .join(" · ");

  return (
    <aside className="flex flex-col gap-6 p-7 bg-surface-card border border-hairline rounded-2">
      <div>
        <div className="font-sans text-[12px] font-semibold uppercase tracking-uc text-muted">References found</div>
        <div className="flex items-baseline gap-3 mt-2">
          <em className="not-italic font-light text-ink leading-none font-serif text-[clamp(56px,6vw,88px)]">{stats.total}</em>
          <small className="font-sans text-[12px] uppercase tracking-uc text-muted">across {stats.shots} shots</small>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <div className={BREAKDOWN_ROW}>
          <span>
            <span className={SWATCH} style={{ background: "var(--grad-peach)" }} />
            Confirmed
          </span>
          <span className="text-ink font-semibold">{stats.confirmed}</span>
        </div>
        <div className={BREAKDOWN_ROW}>
          <span>
            <span className={SWATCH} style={{ background: "var(--grad-sky)" }} />
            Speculative
          </span>
          <span className="text-ink font-semibold">{stats.speculative}</span>
        </div>
        <div className={BREAKDOWN_ROW}>
          <span>
            <span className={SWATCH} style={{ background: "var(--error)" }} />
            Hidden
          </span>
          <span className="text-ink font-semibold">{stats.hidden}</span>
        </div>
      </div>
      {showSources && (
        <div className="font-sans text-[12px] font-semibold leading-[1.6] text-body">
          Sources span {stats.minYear} → {stats.maxYear} · {typeText}
        </div>
      )}
    </aside>
  );
}
