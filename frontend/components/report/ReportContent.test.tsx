import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Mock VideoPlayer so the test does not load a YouTube iframe.
vi.mock("@/components/VideoPlayer", () => {
  const React = require("react");
  return {
    VideoPlayer: React.forwardRef((_props: { youtubeId: string }, ref: any) => {
      const handle = { seekTo: vi.fn() };
      React.useImperativeHandle(ref, () => handle);
      // Expose the spy globally so the test can inspect it
      (globalThis as any).__lastSeekTo = handle.seekTo;
      return null;
    }),
  };
});
import { ReportContent } from "./ReportContent";
import type { Report, LyricLink } from "@/lib/types";

const fakeReport: Report = {
  youtube_id: "abc",
  title: "T",
  channel: "C",
  duration_s: 100,
  references: [],
  frame_analyses: [],
};

beforeEach(() => {
  window.location.hash = "";
  (globalThis as any).__lastSeekTo = vi.fn();
});
afterEach(() => {
  window.location.hash = "";
});

describe("ReportContent hash-seek", () => {
  it("calls seekTo when hash is #t=NN and clears the hash", async () => {
    window.location.hash = "#t=42.5";
    render(<ReportContent report={fakeReport} youtubeId="abc" />);
    await new Promise((r) => setTimeout(r, 10));
    expect((globalThis as any).__lastSeekTo).toHaveBeenCalledWith(42.5);
    expect(window.location.hash).toBe("");
  });

  it("does not call seekTo when hash is absent", async () => {
    render(<ReportContent report={fakeReport} youtubeId="abc" />);
    await new Promise((r) => setTimeout(r, 10));
    expect((globalThis as any).__lastSeekTo).not.toHaveBeenCalled();
  });

  it("does not call seekTo when hash is malformed", async () => {
    window.location.hash = "#t=abc";
    render(<ReportContent report={fakeReport} youtubeId="abc" />);
    await new Promise((r) => setTimeout(r, 10));
    expect((globalThis as any).__lastSeekTo).not.toHaveBeenCalled();
  });
});

const lyricLink: LyricLink = {
  lyric_timestamp_s: 42,
  lyric: "gold on my mind",
  frame_id: "shot_00",
  frame_timestamp_s: 42,
  relation: "motif",
  note: "palette warms to gold",
};

describe("ReportContent tabs", () => {
  it("shows no tab switch when there are no lyrics links", () => {
    render(<ReportContent report={fakeReport} youtubeId="abc" />);
    expect(screen.queryByRole("tab", { name: /lyrics/i })).not.toBeInTheDocument();
  });

  it("shows tabs and switches to the lyrics timeline when links exist", () => {
    const report = { ...fakeReport, lyrics_links: [lyricLink] };
    render(<ReportContent report={report} youtubeId="abc" />);
    // References tab is the default; lyric text not visible yet.
    expect(screen.queryByText(/gold on my mind/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /lyrics/i }));
    expect(screen.getByText(/gold on my mind/)).toBeInTheDocument();
  });

  it("scopes the FilterBar to the References tab", () => {
    const report = { ...fakeReport, lyrics_links: [lyricLink] };
    render(<ReportContent report={report} youtubeId="abc" />);
    // FilterBar (its verdict chips) is present on the default References tab.
    expect(
      screen.getByRole("button", { name: /confirmed/i }),
    ).toBeInTheDocument();
    // Switching to the Lyrics tab unmounts the FilterBar.
    fireEvent.click(screen.getByRole("tab", { name: /lyrics/i }));
    expect(
      screen.queryByRole("button", { name: /confirmed/i }),
    ).not.toBeInTheDocument();
  });
});
