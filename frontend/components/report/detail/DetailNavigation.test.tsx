import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useDetailKeyboardNav } from "./useDetailKeyboardNav";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function Probe({ index, total, youtubeId }: { index: number; total: number; youtubeId: string }) {
  useDetailKeyboardNav({ youtubeId, index, total });
  return null;
}

afterEach(() => {
  push.mockClear();
});

describe("useDetailKeyboardNav", () => {
  it("ArrowRight pushes /ref/{n+1} when not at end", () => {
    render(<Probe index={0} total={3} youtubeId="abc" />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(push).toHaveBeenCalledWith("/report/abc/ref/1");
  });

  it("ArrowLeft pushes /ref/{n-1} when not at start", () => {
    render(<Probe index={2} total={3} youtubeId="abc" />);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(push).toHaveBeenCalledWith("/report/abc/ref/1");
  });

  it("ArrowRight at last index does nothing", () => {
    render(<Probe index={2} total={3} youtubeId="abc" />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(push).not.toHaveBeenCalled();
  });

  it("ArrowLeft at first index does nothing", () => {
    render(<Probe index={0} total={3} youtubeId="abc" />);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(push).not.toHaveBeenCalled();
  });

  it("Escape pushes /report/{id}", () => {
    render(<Probe index={1} total={3} youtubeId="abc" />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(push).toHaveBeenCalledWith("/report/abc");
  });
});
