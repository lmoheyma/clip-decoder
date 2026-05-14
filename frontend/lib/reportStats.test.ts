import { describe, it, expect } from "vitest";
import { computeReportStats } from "./reportStats";
import type { Report, VerifiedReference } from "./types";

function makeRef(overrides: Partial<VerifiedReference>): VerifiedReference {
  return {
    timestamp_s: 0,
    source_frame_id: "shot_00",
    work_title: "Untitled",
    work_creator: "Anon",
    work_year: 2000,
    work_type: "Painting",
    raw_confidence: 0.5,
    verdict: "keep",
    final_confidence: "confirmed",
    supporting_elements: [],
    wikipedia_url: null,
    cross_ref_reasoning: "",
    adversarial_reasoning: "",
    wikipedia_reasoning: "",
    medium: null,
    institution: null,
    inception_year: null,
    ...overrides,
  };
}

function makeReport(refs: VerifiedReference[]): Report {
  return {
    youtube_id: "x",
    title: "",
    channel: "",
    duration_s: 100,
    references: refs,
    frame_analyses: [],
  };
}

describe("computeReportStats", () => {
  it("returns zero counts for empty references", () => {
    const stats = computeReportStats(makeReport([]));
    expect(stats.confirmed).toBe(0);
    expect(stats.speculative).toBe(0);
    expect(stats.hidden).toBe(0);
    expect(stats.total).toBe(0);
    expect(stats.minYear).toBeNull();
    expect(stats.maxYear).toBeNull();
    expect(stats.typeBreakdown).toEqual([]);
    expect(stats.availableTypes).toEqual([]);
  });

  it("counts each verdict correctly", () => {
    const stats = computeReportStats(
      makeReport([
        makeRef({ final_confidence: "confirmed" }),
        makeRef({ final_confidence: "confirmed" }),
        makeRef({ final_confidence: "speculative" }),
        makeRef({ final_confidence: "hidden" }),
      ]),
    );
    expect(stats.confirmed).toBe(2);
    expect(stats.speculative).toBe(1);
    expect(stats.hidden).toBe(1);
    expect(stats.total).toBe(4);
  });

  it("returns min/max year ignoring null years", () => {
    const stats = computeReportStats(
      makeReport([
        makeRef({ work_year: 1929 }),
        makeRef({ work_year: null }),
        makeRef({ work_year: 2014 }),
        makeRef({ work_year: 1979 }),
      ]),
    );
    expect(stats.minYear).toBe(1929);
    expect(stats.maxYear).toBe(2014);
  });

  it("groups type breakdown sorted by count desc", () => {
    const stats = computeReportStats(
      makeReport([
        makeRef({ work_type: "Film" }),
        makeRef({ work_type: "Film" }),
        makeRef({ work_type: "Painting" }),
        makeRef({ work_type: "Film" }),
        makeRef({ work_type: "Photograph" }),
      ]),
    );
    expect(stats.typeBreakdown).toEqual([
      { type: "Film", count: 3 },
      { type: "Painting", count: 1 },
      { type: "Photograph", count: 1 },
    ]);
    expect(stats.availableTypes).toEqual(["Film", "Painting", "Photograph"]);
  });
});
