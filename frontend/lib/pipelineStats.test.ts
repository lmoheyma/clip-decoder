import { describe, it, expect } from "vitest";
import { classifySteps } from "./pipelineStats";
import type { PipelineEvent } from "./types";

function ev(
  step: PipelineEvent["step"],
  progress = 0,
  payload: Record<string, unknown> = {},
): PipelineEvent {
  return { step, message: "", progress, payload };
}

describe("classifySteps", () => {
  it("returns all pending when no events", () => {
    const steps = classifySteps([]);
    expect(steps).toHaveLength(6);
    for (const s of steps) {
      expect(s.status).toBe("pending");
      expect(s.progress).toBe(0);
    }
  });

  it("marks vision active with partial frame count", () => {
    const steps = classifySteps([
      ev("ingest", 0.1),
      ev("shots", 0.2, { shot_count: 62 }),
      ev("vision", 0.25),
      ev("vision_frame", 0.4, { shot_index: 34, total_shots: 62 }),
    ]);
    const ingest = steps.find((s) => s.key === "ingest")!;
    const shots = steps.find((s) => s.key === "shots")!;
    const vision = steps.find((s) => s.key === "vision")!;
    const crossref = steps.find((s) => s.key === "crossref")!;
    expect(ingest.status).toBe("done");
    expect(shots.status).toBe("done");
    expect(vision.status).toBe("active");
    expect(vision.fraction).toBe("1 / 62");
    expect(crossref.status).toBe("pending");
  });

  it("marks verify done and lyrics active when a lyrics event arrives", () => {
    const steps = classifySteps([
      ev("ingest", 0.1),
      ev("shots", 0.2),
      ev("vision", 0.55),
      ev("crossref", 0.7),
      ev("verify", 0.88),
      ev("lyrics", 0.92),
    ]);
    const verify = steps.find((s) => s.key === "verify")!;
    const lyrics = steps.find((s) => s.key === "lyrics")!;
    expect(verify.status).toBe("done");
    expect(lyrics.status).toBe("active");
    expect(lyrics.progress).toBeCloseTo(0.2, 5);
  });

  it("marks all done when done event seen", () => {
    const steps = classifySteps([
      ev("ingest", 0.1),
      ev("shots", 0.2),
      ev("vision", 0.55),
      ev("crossref", 0.7),
      ev("verify", 0.88),
      ev("lyrics", 0.99),
      ev("done", 1.0),
    ]);
    for (const s of steps) {
      expect(s.status).toBe("done");
    }
  });
});
