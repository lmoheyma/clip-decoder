import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DetailCompare } from "./DetailCompare";
import type { VerifiedReference, FrameAnalysis } from "@/lib/types";

// Mock VideoPlayer so the test does not load a YouTube iframe.
vi.mock("@/components/VideoPlayer", () => {
  const React = require("react");
  return {
    VideoPlayer: React.forwardRef((props: { youtubeId: string }, ref: any) => {
      const handle = { seekTo: vi.fn() };
      React.useImperativeHandle(ref, () => handle);
      (globalThis as any).__lastSeekTo = handle.seekTo;
      (globalThis as any).__lastYoutubeId = props.youtubeId;
      return null;
    }),
  };
});

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

beforeEach(() => {
  (globalThis as any).__lastSeekTo = vi.fn();
  (globalThis as any).__lastYoutubeId = undefined;
});

describe("DetailCompare", () => {
  it("renders the wikipedia thumbnail in the right pane", () => {
    render(<DetailCompare reference={baseRef} frame={fa} youtubeId="abc" frameIndex={0} />);
    const thumb = screen.getByAltText("Le faux miroir");
    expect(thumb.getAttribute("src")).toBe("https://upload.wikimedia.org/foo.jpg");
  });

  it("mounts VideoPlayer in the left pane with the report's youtubeId", () => {
    render(<DetailCompare reference={baseRef} frame={fa} youtubeId="abc" frameIndex={0} />);
    expect((globalThis as any).__lastYoutubeId).toBe("abc");
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

  it("calls VideoPlayer.seekTo with reference.timestamp_s on mount", async () => {
    render(
      <DetailCompare
        reference={{ ...baseRef, timestamp_s: 42.5 }}
        frame={fa}
        youtubeId="abc"
        frameIndex={0}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect((globalThis as any).__lastSeekTo).toHaveBeenCalledWith(42.5);
  });

  it("re-calls seekTo when the reference's timestamp_s changes", async () => {
    const { rerender } = render(
      <DetailCompare
        reference={{ ...baseRef, timestamp_s: 42.5 }}
        frame={fa}
        youtubeId="abc"
        frameIndex={0}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    (globalThis as any).__lastSeekTo.mockClear();
    rerender(
      <DetailCompare
        reference={{ ...baseRef, timestamp_s: 88.0 }}
        frame={fa}
        youtubeId="abc"
        frameIndex={0}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect((globalThis as any).__lastSeekTo).toHaveBeenCalledWith(88.0);
  });
});
