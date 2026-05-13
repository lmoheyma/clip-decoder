import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DetailReasoning, extractPullQuote } from "./DetailReasoning";

describe("extractPullQuote", () => {
  it("returns the first sentence ending in a period", () => {
    expect(extractPullQuote("The frame is the painting. A single eye fills the canvas."))
      .toBe("The frame is the painting.");
  });
  it("handles ! and ?", () => {
    expect(extractPullQuote("Wow! It is.")).toBe("Wow!");
    expect(extractPullQuote("Is it Magritte? Yes."))
      .toBe("Is it Magritte?");
  });
  it("falls back to a 240-char cap with ellipsis when no terminator", () => {
    const long = "a".repeat(300);
    const q = extractPullQuote(long);
    expect(q.length).toBeLessThanOrEqual(240);
    expect(q.endsWith("…")).toBe(true);
  });
  it("returns the whole string when shorter than 240 chars and no terminator", () => {
    expect(extractPullQuote("short text no terminator"))
      .toBe("short text no terminator");
  });
});

describe("DetailReasoning", () => {
  it("renders the three labeled sections", () => {
    render(
      <DetailReasoning
        crossRef="The frame is the painting."
        adversarial="But the eye is bare in Bergman."
        wikipedia="MoMA accession is correct."
      />,
    );
    expect(screen.getByText(/Cross-reference pass/i)).toBeInTheDocument();
    expect(screen.getByText(/Adversarial pass/i)).toBeInTheDocument();
    expect(screen.getByText(/Wikipedia/i)).toBeInTheDocument();
  });
  it("renders the pull-quote from the first sentence of crossRef", () => {
    render(
      <DetailReasoning
        crossRef="The frame is the painting. A single eye."
        adversarial="x"
        wikipedia="y"
      />,
    );
    expect(screen.getByText("The frame is the painting.")).toBeInTheDocument();
  });
});
