"use client";
import type { ReportStats } from "@/lib/reportStats";

export function SummaryCard({ stats }: { stats: ReportStats }) {
  const showSources = stats.minYear !== null && stats.maxYear !== null;
  const typeText = stats.typeBreakdown
    .map((t) => `${t.count} ${t.type.toLowerCase()}${t.count > 1 ? "s" : ""}`)
    .join(" · ");

  return (
    <aside className="summary-card">
      <div>
        <div className="hairline">References found</div>
        <div className="summary-num">
          <em className="serif-it">{stats.total}</em>
          <small>across {stats.shots} shots</small>
        </div>
      </div>
      <div className="breakdown">
        <div>
          <span>
            <span className="swatch" style={{ background: "var(--grad-peach)" }} />
            Confirmed
          </span>
          <span className="v">{stats.confirmed}</span>
        </div>
        <div>
          <span>
            <span className="swatch" style={{ background: "var(--grad-sky)" }} />
            Speculative
          </span>
          <span className="v">{stats.speculative}</span>
        </div>
        <div>
          <span>
            <span className="swatch" style={{ background: "var(--error)" }} />
            Hidden
          </span>
          <span className="v">{stats.hidden}</span>
        </div>
      </div>
      {showSources && (
        <div className="hairline summary-sources">
          Sources span {stats.minYear} → {stats.maxYear} · {typeText}
        </div>
      )}
    </aside>
  );
}
