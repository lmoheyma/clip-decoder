import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { createRef } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "./VideoPlayer";

vi.mock("react-player", () => ({
  default: vi.fn(() => <div data-testid="rp" />),
}));

describe("VideoPlayer", () => {
  it("exposes seekTo via ref", () => {
    const ref = createRef<VideoPlayerHandle>();
    render(<VideoPlayer ref={ref} youtubeId="abc" />);
    expect(typeof ref.current?.seekTo).toBe("function");
    act(() => ref.current?.seekTo(42));
  });
});
