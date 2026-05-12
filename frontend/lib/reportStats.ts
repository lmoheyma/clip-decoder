import type { Report, VerifiedReference } from "./types";

export interface ReportStats {
  total: number;
  confirmed: number;
  speculative: number;
  hidden: number;
  shots: number;
  wikiHits: number;
  minYear: number | null;
  maxYear: number | null;
  typeBreakdown: { type: string; count: number }[];
  availableTypes: string[];
}

export function computeReportStats(report: Report): ReportStats {
  const refs: VerifiedReference[] = report.references;
  let confirmed = 0;
  let speculative = 0;
  let hidden = 0;
  let wikiHits = 0;
  const years: number[] = [];
  const typeCounts = new Map<string, number>();

  for (const r of refs) {
    if (r.final_confidence === "confirmed") confirmed++;
    else if (r.final_confidence === "speculative") speculative++;
    else if (r.final_confidence === "hidden") hidden++;
    if (r.wikipedia_url) wikiHits++;
    if (typeof r.work_year === "number") years.push(r.work_year);
    typeCounts.set(r.work_type, (typeCounts.get(r.work_type) ?? 0) + 1);
  }

  const typeBreakdown = Array.from(typeCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  return {
    total: refs.length,
    confirmed,
    speculative,
    hidden,
    shots: report.frame_analyses.length,
    wikiHits,
    minYear: years.length ? Math.min(...years) : null,
    maxYear: years.length ? Math.max(...years) : null,
    typeBreakdown,
    availableTypes: typeBreakdown.map((t) => t.type),
  };
}
