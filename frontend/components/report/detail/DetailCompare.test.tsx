import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DetailCompare } from "./DetailCompare";
import type { VerifiedReference, FrameAnalysis } from "@/lib/types";

const fa: FrameAnalysis = {
  timestamp_s: 12,
  frame_id: "shot_03",
  composition: "centered subject filling 90% of frame",
  palette: ["midnight", "sodium"],
  palette_hex: ["#111", "#fa3"],
  camera_move: "static",
  costume_setting: "indoor",
  distinctive_features: ["symmetry"],
  raw_description: "x",
  confidence_in_observation: 0.94,
};
const baseRef: VerifiedReference = {
  timestamp_s: 12,
  source_frame_id: "shot_03",
  work_title: "Le faux miroir",
  work_creator: "René Magritte",
  work_year: 1929,
  work_type: "painting",
  raw_confidence: 0.91,
  verdict: "keep",
  final_confidence: "confirmed",
  supporting_elements: [],
  wikipedia_url: "https://en.wikipedia.org/wiki/Le_faux_miroir",
  wikipedia_thumbnail_url: "https://upload.wikimedia.org/foo.jpg",
  cross_ref_reasoning: "x",
  adversarial_reasoning: "x",
  wikipedia_reasoning: "x",
  medium: "oil on canvas",
  institution: "Museum of Modern Art",
  inception_year: 1929,
};

describe("DetailCompare", () => {
  it("renders the wikipedia thumbnail when present", () => {
    render(<DetailCompare reference={baseRef} frame={fa} youtubeId="abc" frameIndex={0} />);
    const imgs = screen.getAllByRole("img", { hidden: true });
    // At least one img has the wiki thumb src.
    expect(imgs.some(i => i.getAttribute("src") === "https://upload.wikimedia.org/foo.jpg")).toBe(true);
  });

  it("renders the placeholder when thumbnail is null", () => {
    render(
      <DetailCompare
        reference={{ ...baseRef, wikipedia_thumbnail_url: null }}
        frame={fa}
        youtubeId="abc"
        frameIndex={0}
      />,
    );
    expect(screen.getByText(/reference image/i)).toBeInTheDocument();
  });

  it("joins only non-null metadata in the right-pane sub line", () => {
    render(
      <DetailCompare
        reference={{ ...baseRef, medium: null }}
        frame={fa}
        youtubeId="abc"
        frameIndex={0}
      />,
    );
    const sub = screen.getByTestId("detail-compare-sub");
    // medium is null → should NOT be in the joined string
    expect(sub.textContent).toContain("René Magritte");
    expect(sub.textContent).toContain("1929");
    expect(sub.textContent).toContain("Museum of Modern Art");
    expect(sub.textContent).not.toContain("oil on canvas");
  });
});
