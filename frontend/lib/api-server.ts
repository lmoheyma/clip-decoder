import "server-only";
import type { Report } from "./types";

/**
 * Server-side fetch for the report. Distinct from `fetchReport` in
 * `lib/api.ts`, which uses a relative URL (browser-only). Server
 * components run in Node and need an absolute URL.
 *
 * Uses BACKEND_URL — the same env var that `next.config.ts` rewrites
 * /api/* to — so the rewrite target and the server-side fetch target
 * stay aligned. Defaults to the docker-compose service name.
 */
export async function fetchReportServer(youtubeId: string): Promise<Report | null> {
  const base = process.env.BACKEND_URL ?? "http://backend:8000";
  const r = await fetch(`${base}/api/report/${encodeURIComponent(youtubeId)}`, {
    cache: "no-store",
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`report failed: ${r.status}`);
  return (await r.json()) as Report;
}
