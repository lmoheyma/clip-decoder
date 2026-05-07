import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HeroForm } from "./HeroForm";

describe("HeroForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("submits URL and calls onSubmit with the response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        youtube_id: "abc",
        status: "running",
        status_stream_url: "/api/stream/abc",
      }),
    }));
    const onSubmit = vi.fn();
    render(<HeroForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByPlaceholderText(/youtube/i), {
      target: { value: "https://www.youtube.com/watch?v=abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: /decode/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ youtube_id: "abc" }),
      ),
    );
  });

  it("shows error message on bad URL response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ detail: "bad" }),
    }));
    render(<HeroForm onSubmit={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/youtube/i), {
      target: { value: "not-a-url" },
    });
    fireEvent.click(screen.getByRole("button", { name: /decode/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
