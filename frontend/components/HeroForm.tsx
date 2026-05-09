"use client";
import { useState } from "react";
import { startAnalysis, type StartAnalysisResponse } from "@/lib/api";

export function HeroForm({
  onSubmit,
}: {
  onSubmit: (r: StartAnalysisResponse) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await startAnalysis(url);
      onSubmit(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-2xl flex flex-col gap-3">
      <label
        htmlFor="hero-youtube-url"
        className="font-mono uppercase text-[10px] tracking-mono-label text-black/55"
      >
        ↳ YouTube URL
      </label>

      <div className="aurora-ring rounded-sharp">
        <div className="flex gap-2 items-stretch glass-light rounded-sharp p-1.5 shadow-midnight-soft">
          <input
            id="hero-youtube-url"
            type="text"
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            autoComplete="off"
            className="flex-1 px-4 py-3.5 bg-transparent outline-none text-[16px] tracking-body placeholder:text-black/35"
          />
          <button
            type="submit"
            disabled={busy}
            className="btn-midnight inline-flex items-center gap-2"
          >
            <span>{busy ? "Working" : "Decode"}</span>
            <span aria-hidden className={busy ? "opacity-0" : "translate-x-0 transition-transform"}>
              →
            </span>
            {busy && (
              <span
                aria-hidden
                className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"
              />
            )}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <span className="font-mono uppercase tracking-mono-label text-black/45">
          Streams progress live · no signup
        </span>
        {error && (
          <span
            role="alert"
            className="font-mono uppercase tracking-mono-label text-[#fc4c02]"
          >
            ⚠ {error}
          </span>
        )}
      </div>
    </form>
  );
}
