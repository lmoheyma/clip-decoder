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
      <form onSubmit={submit} className="url-form">
        <input
          id="hero-youtube-url"
          type="text"
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          autoComplete="off"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary mr-2"
        >
          <span>{busy ? "Working" : "Decode"}</span>
        </button>
      </form>
      {error && (
        <span role="alert" className="error">
          ⚠ {error}
        </span>
      )}
    </div>
  );
}
