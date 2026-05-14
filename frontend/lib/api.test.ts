import { describe, expect, it, vi, beforeEach } from "vitest";
import { startAnalysis, fetchReport } from "./api";

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("startAnalysis posts URL and returns server response", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        youtube_id: "abc",
        status: "running",
        status_stream_url: "/api/stream/abc",
      }),
    });
    vi.stubGlobal("fetch", mock);
    const r = await startAnalysis("https://www.youtube.com/watch?v=abc");
    expect(r.youtube_id).toBe("abc");
    expect(mock).toHaveBeenCalledWith(
      "/api/analyze",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fetchReport returns parsed report on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        youtube_id: "abc", title: "t", channel: "c", duration_s: 0,
        references: [], frame_analyses: [],
      }),
    }));
    const r = await fetchReport("abc");
    expect(r?.youtube_id).toBe("abc");
  });

  it("fetchReport returns null on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 404,
    }));
    const r = await fetchReport("abc");
    expect(r).toBeNull();
  });

});
