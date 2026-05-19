"use client";
import type { CrossrefCandidatePayload, PipelineEvent } from "@/lib/types";

const HAIRLINE = "font-sans text-[12px] font-semibold uppercase tracking-uc text-muted";

const CARD_BASE =
  "bg-surface-card rounded-2 px-4 py-3.5 opacity-0 animate-[candidate-fade-in_0.4s_ease_forwards]";

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
      <div className={`${HAIRLINE} mt-2 mb-3`}>
        Early signal — candidates surfacing
      </div>
      <div className="flex flex-col gap-2.5 flex-1 max-h-[calc(100vh-200px)] overflow-y-auto pr-1">
        {candidates.length === 0 ? (
          <div className="font-sans text-[12px] uppercase tracking-uc text-muted-soft text-center px-4 py-8">
            No candidates yet…
          </div>
        ) : (
          candidates.map((c, i) => (
            <div
              key={`${c.timestamp_s}-${c.work_title}-${i}`}
              className={`${CARD_BASE} ${
                c.raw_confidence < 0.5
                  ? "border border-dashed border-[color:color-mix(in_oklab,var(--grad-sky)_35%,transparent)]"
                  : "border border-hairline"
              }`}
              style={{ animationDelay: `${Math.min(i * 80, 800)}ms` }}
            >
              <div
                className={HAIRLINE}
                style={{
                  color: c.raw_confidence < 0.5 ? "var(--grad-sky)" : "var(--grad-peach)",
                }}
              >
                {formatTimecode(c.timestamp_s)} ·{" "}
                {c.raw_confidence < 0.5 ? "weak signal" : "candidate"}
              </div>
              <div className="font-serif font-light not-italic tracking-[-0.01em] mt-1 text-ink text-[19px]">
                {c.work_title}
              </div>
              <div className={`${HAIRLINE} mt-1`}>
                {c.work_creator}
                {c.work_year ? `, ${c.work_year}` : ""}
              </div>
              <div className={`${HAIRLINE} mt-2.5 text-muted-soft`}>
                awaiting verify ◌
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
