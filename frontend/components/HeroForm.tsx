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
    <form onSubmit={submit} className="w-full max-w-2xl flex flex-col gap-4">
      <label className="font-mono uppercase text-[11px] tracking-mono-label text-black/60">
        YouTube URL
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          className="flex-1 px-4 py-3 rounded-sharp border border-black/10 bg-white shadow-midnight outline-none focus:border-midnight"
        />
        <button
          type="submit"
          disabled={busy}
          className="px-6 py-3 rounded-sharp bg-midnight text-white disabled:opacity-50"
        >
          {busy ? "Working…" : "Decode"}
        </button>
      </div>
      {error && (
        <div role="alert" className="text-[14px] text-brand-orange">
          {error}
        </div>
      )}
    </form>
  );
}
