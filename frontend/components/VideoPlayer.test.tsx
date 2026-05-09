import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { createRef } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "./VideoPlayer";

describe("VideoPlayer", () => {
  it("exposes seekTo via ref and posts the YT IFrame command", () => {
    const ref = createRef<VideoPlayerHandle>();
    const { container } = render(<VideoPlayer ref={ref} youtubeId="abc" />);

    expect(typeof ref.current?.seekTo).toBe("function");

    const iframe = container.querySelector("iframe") as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe?.src).toMatch(/youtube-nocookie\.com\/embed\/abc/);

    // Stub the iframe's contentWindow.postMessage so we can assert the
    // YT IFrame API command shape.
    const post = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage: post },
      configurable: true,
    });

    act(() => ref.current?.seekTo(42));
    expect(post).toHaveBeenCalledTimes(1);
    const [payload, target] = post.mock.calls[0];
    expect(JSON.parse(payload)).toEqual({
      event: "command",
      func: "seekTo",
      args: [42, true],
    });
    expect(target).toBe("https://www.youtube-nocookie.com");
  });
});
