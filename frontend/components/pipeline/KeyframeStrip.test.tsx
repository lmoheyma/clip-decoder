import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { KeyframeStrip } from "./KeyframeStrip";

describe("KeyframeStrip", () => {
  it("renders N pending cells from keyframes list", () => {
    const keyframes = [
      { shot_id: "shot_00", timestamp_s: 8 },
      { shot_id: "shot_01", timestamp_s: 21 },
      { shot_id: "shot_02", timestamp_s: 42 },
    ];
    render(
      <KeyframeStrip
        keyframes={keyframes}
        analyzedIds={new Set()}
        latestId={null}
        youtubeId="x"
      />,
    );
    const cells = screen.getAllByTestId("kf-cell");
    expect(cells).toHaveLength(3);
    for (const cell of cells) {
      expect(cell.className).toContain("pending");
    }
  });

  it("marks analyzed cells when their shot_id is in analyzedIds", () => {
    const keyframes = [
      { shot_id: "shot_00", timestamp_s: 8 },
      { shot_id: "shot_01", timestamp_s: 21 },
    ];
    render(
      <KeyframeStrip
        keyframes={keyframes}
        analyzedIds={new Set(["shot_00"])}
        latestId="shot_00"
        youtubeId="x"
      />,
    );
    const cells = screen.getAllByTestId("kf-cell");
    expect(cells[0].className).not.toContain("pending");
    expect(cells[0].className).toContain("latest");
    expect(cells[1].className).toContain("pending");
  });
});
