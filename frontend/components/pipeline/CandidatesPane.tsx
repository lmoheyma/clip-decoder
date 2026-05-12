"use client";
import type { CrossrefCandidatePayload, PipelineEvent } from "@/lib/types";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
}

export function CandidatesPane({ events }: { events: PipelineEvent[] }) {
  const candidates: CrossrefCandidatePayload[] = events
    .filter((e) => e.step === "crossref_candidate")
    .map((e) => e.payload as unknown as CrossrefCandidatePayload);

  return (
    <>
      <div
        className="hairline"
        style={{ marginTop: 8, marginBottom: 12 }}
      >
        Early signal — candidates surfacing
      </div>
      <div className="candidates-pane">
        {candidates.length === 0 ? (
          <div className="candidates-empty">No candidates yet…</div>
        ) : (
          candidates.map((c, i) => (
            <div
              key={`${c.timestamp_s}-${c.work_title}-${i}`}
              className={`candidate-card ${c.raw_confidence < 0.5 ? "weak" : ""}`}
              style={{ animationDelay: `${Math.min(i * 80, 800)}ms` }}
            >
              <div
                className="hairline"
                style={{
                  color: c.raw_confidence < 0.5 ? "var(--grad-sky)" : "var(--grad-peach)",
                }}
              >
                {formatTimecode(c.timestamp_s)} ·{" "}
                {c.raw_confidence < 0.5 ? "weak signal" : "candidate"}
              </div>
              <div
                className="serif-it"
                style={{ fontSize: 19, marginTop: 4, color: "var(--ink)" }}
              >
                {c.work_title}
              </div>
              <div className="hairline" style={{ marginTop: 4 }}>
                {c.work_creator}
                {c.work_year ? `, ${c.work_year}` : ""}
              </div>
              <div
                className="hairline"
                style={{ marginTop: 10, color: "var(--muted-soft)", fontSize: 12 }}
              >
                awaiting verify ◌
              </div>
            </div>
          ))
        )}

        <div className="candidates-footer">
          <div className="hairline">You can close this tab</div>
          <div className="candidates-footer-body">
            Analysis runs server-side. Bookmark the report URL — it&apos;ll fill in
            as the pipeline finishes.
          </div>
        </div>
      </div>
    </>
  );
}
