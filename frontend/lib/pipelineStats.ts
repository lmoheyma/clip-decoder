import type { PipelineEvent } from "./types";

export type StepStatus = "pending" | "active" | "done" | "error";

export interface StepInfo {
  key: "ingest" | "shots" | "vision" | "crossref" | "verify";
  label: string;
  status: StepStatus;
  progress: number;
  fraction: string;
}

interface Band {
  key: StepInfo["key"];
  label: string;
  floor: number;
  ceiling: number;
}

const BANDS: Band[] = [
  { key: "ingest",   label: "Ingest",    floor: 0.00, ceiling: 0.10 },
  { key: "shots",    label: "Shots",     floor: 0.10, ceiling: 0.20 },
  { key: "vision",   label: "Vision",    floor: 0.20, ceiling: 0.55 },
  { key: "crossref", label: "Cross-ref", floor: 0.55, ceiling: 0.70 },
  { key: "verify",   label: "Verify",    floor: 0.70, ceiling: 1.00 },
];

export function classifySteps(events: PipelineEvent[]): StepInfo[] {
  const seen = new Set(events.map((e) => e.step));
  const finished = seen.has("done");
  const failed = seen.has("error");
  const overall = events.length
    ? Math.max(...events.map((e) => e.progress ?? 0))
    : 0;

  const visionFrameCount = events.filter((e) => e.step === "vision_frame").length;
  const totalShots =
    (events.findLast((e) => e.step === "shots")?.payload as { shot_count?: number } | undefined)
      ?.shot_count;
  const crossrefCandidates = events.filter(
    (e) => e.step === "crossref_candidate",
  ).length;

  return BANDS.map<StepInfo>((band) => {
    let status: StepStatus = "pending";
    let fraction = "pending";
    let progress = 0;

    if (finished) {
      status = "done";
      fraction = "done";
      progress = 1;
    } else if (failed && overall < band.ceiling) {
      status = "error";
      fraction = "error";
    } else if (overall >= band.ceiling - 1e-6) {
      status = "done";
      fraction = "done";
      progress = 1;
    } else if (overall > band.floor || seen.has(band.key)) {
      status = "active";
      const span = band.ceiling - band.floor;
      progress = Math.min(1, Math.max(0, (overall - band.floor) / span));
    }

    if (band.key === "shots" && status === "done" && typeof totalShots === "number") {
      fraction = `${totalShots} / ${totalShots}`;
    }
    if (band.key === "vision" && status === "active" && typeof totalShots === "number") {
      fraction = `${visionFrameCount} / ${totalShots}`;
    }
    if (band.key === "vision" && status === "done" && typeof totalShots === "number") {
      fraction = `${totalShots} / ${totalShots}`;
    }
    if (band.key === "crossref" && status === "active") {
      fraction = `${crossrefCandidates} found`;
    }
    if (band.key === "crossref" && status === "done") {
      fraction = `${crossrefCandidates} candidates`;
    }

    return { key: band.key, label: band.label, status, progress, fraction };
  });
}
