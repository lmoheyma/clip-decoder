import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LyricsTimeline } from "./LyricsTimeline";
import type { LyricLink } from "@/lib/types";

const links: LyricLink[] = [
  {
    lyric_timestamp_s: 42,
    lyric: "running through the city",
    frame_id: "shot_03",
    frame_timestamp_s: 43,
    relation: "literal",
    note: "streaked night streets",
  },
  {
    lyric_timestamp_s: 75,
    lyric: "gold on my mind",
    frame_id: "shot_07",
    frame_timestamp_s: 75,
    relation: "motif",
    note: "palette warms to gold",
  },
];

describe("LyricsTimeline", () => {
  it("renders one row per link with lyric, note and relation", () => {
    render(<LyricsTimeline links={links} youtubeId="abc" onSeek={() => {}} />);
    expect(screen.getByText(/running through the city/)).toBeInTheDocument();
    expect(screen.getByText(/streaked night streets/)).toBeInTheDocument();
    expect(screen.getByText(/literal/i)).toBeInTheDocument();
    expect(screen.getByText(/01:15/)).toBeInTheDocument(); // 75s formatted
  });

  it("calls onSeek with the lyric timestamp when a row is clicked", () => {
    const onSeek = vi.fn();
    render(<LyricsTimeline links={links} youtubeId="abc" onSeek={onSeek} />);
    fireEvent.click(screen.getByRole("button", { name: /running through the city/i }));
    expect(onSeek).toHaveBeenCalledWith(42);
  });
});
