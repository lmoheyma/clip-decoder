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
      setBusy(false);
    }
  }

  return (
    <div>
      <form
        onSubmit={submit}
        className="flex items-center gap-3 w-full max-w-[640px] py-1 pl-4 pr-1 rounded-full border border-hairline-strong bg-canvas-soft transition-colors duration-200 focus-within:border-ink"
      >
        <input
          id="hero-youtube-url"
          type="text"
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          autoComplete="off"
          disabled={busy}
          className="flex-1 min-w-0 border-0 outline-0 bg-transparent px-2 py-3 text-base font-sans text-ink placeholder:text-muted-soft"
        />
        <button
          type="submit"
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-2.5 mr-2 h-10 px-5 rounded-full border border-ink bg-ink text-on-primary font-sans text-[15px] font-medium cursor-pointer transition-colors duration-200 enabled:hover:bg-white enabled:hover:border-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>{busy ? "Working" : "Decode"}</span>
        </button>
      </form>
      {error && (
        <span
          role="alert"
          className="inline-block mt-3 font-sans text-[12px] uppercase tracking-uc text-error"
        >
          ⚠ {error}
        </span>
      )}
    </div>
  );
}
