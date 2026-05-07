import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ReferencePanel } from "./ReferencePanel";
import type { VerifiedReference } from "@/lib/types";

const refs: VerifiedReference[] = [
  {
    timestamp_s: 12.5, source_frame_id: "shot_03",
    work_title: "The Shining", work_creator: "Stanley Kubrick",
    work_year: 1980, work_type: "film",
    reasoning: "symmetry + corridor + slow tracking",
    raw_confidence: 0.85, verdict: "keep",
    final_confidence: "confirmed",
    supporting_elements: ["symmetry", "corridor", "tracking"],
    wikipedia_url: "https://en.wikipedia.org/wiki/The_Shining",
  },
  {
    timestamp_s: 30.0, source_frame_id: "shot_07",
    work_title: "Don't Look Now", work_creator: "Nicolas Roeg",
    work_year: 1973, work_type: "film",
    reasoning: "red coat in canal frame",
    raw_confidence: 0.55, verdict: "speculative",
    final_confidence: "speculative",
    supporting_elements: ["red coat"],
    wikipedia_url: null,
  },
];

describe("ReferencePanel", () => {
  it("hides speculative references by default", () => {
    render(
      <ReferencePanel
        references={refs}
        showSpeculative={false}
        onJump={() => {}}
        onFlag={() => {}}
      />,
    );
    expect(screen.getByText(/the shining/i)).toBeInTheDocument();
    expect(screen.queryByText(/don't look now/i)).not.toBeInTheDocument();
  });

  it("shows speculative when toggled on", () => {
    render(
      <ReferencePanel
        references={refs}
        showSpeculative={true}
        onJump={() => {}}
        onFlag={() => {}}
      />,
    );
    expect(screen.getByText(/don't look now/i)).toBeInTheDocument();
  });

  it("calls onJump when card clicked", () => {
    const onJump = vi.fn();
    render(
      <ReferencePanel
        references={refs}
        showSpeculative={false}
        onJump={onJump}
        onFlag={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/the shining/i));
    expect(onJump).toHaveBeenCalledWith(refs[0]);
  });

  it("calls onFlag when not-convinced button clicked", () => {
    const onFlag = vi.fn();
    render(
      <ReferencePanel
        references={refs}
        showSpeculative={false}
        onJump={() => {}}
        onFlag={onFlag}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /not convinced/i }));
    expect(onFlag).toHaveBeenCalledWith(0);
  });
});
