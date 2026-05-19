"use client";
import type {
  Confidence,
  CrossrefCandidatePayload,
  PipelineEvent,
  VerifyCandidatePayload,
} from "@/lib/types";

const HAIRLINE = "font-sans text-[11px] font-semibold uppercase tracking-uc text-muted";

const CARD_BASE =
  "bg-surface-card rounded-2 px-3 py-2.5 opacity-0 animate-[candidate-fade-in_0.4s_ease_forwards]";

const VERIFY_LABEL: Record<Confidence, string> = {
  confirmed: "confirmed ●",
  speculative: "speculative ◐",
  hidden: "rejected ✕",
};

const VERIFY_COLOR: Record<Confidence, string> = {
  confirmed: "text-grad-peach",
  speculative: "text-grad-sky",
  hidden: "text-muted-soft",
};

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
}

// Key candidates and their verified results by
// (source_frame_id, work_title, work_creator) so the verify event can
// replace the "awaiting" line on the right card. Including work_creator
// avoids collisions when two different works share a title from the
// same frame (e.g. multiple adaptations of "Macbeth").
function candidateKey(c: {
  source_frame_id: string;
  work_title: string;
  work_creator: string;
}): string {
  return `${c.source_frame_id}::${c.work_title}::${c.work_creator}`;
}

export function CandidatesPane({ events }: { events: PipelineEvent[] }) {
  const candidates: CrossrefCandidatePayload[] = events
    .filter((e) => e.step === "crossref_candidate")
    .map((e) => e.payload as unknown as CrossrefCandidatePayload);

  const verifiedByKey = new Map<string, Confidence>();
  for (const e of events) {
    if (e.step !== "verify_candidate") continue;
    const p = e.payload as unknown as VerifyCandidatePayload;
    verifiedByKey.set(candidateKey(p), p.final_confidence);
  }

  return (
    <>
      <div className={`${HAIRLINE} mt-2 mb-3`}>
        Early signal — candidates surfacing
      </div>
      <div className="flex flex-col gap-2 flex-1 max-h-[calc(100vh-200px)] overflow-y-auto pr-1">
        {candidates.length === 0 ? (
          <div className="font-sans text-[11px] uppercase tracking-uc text-muted-soft text-center px-4 py-8">
            No candidates yet…
          </div>
        ) : (
          candidates.map((c, i) => {
            const verdict = verifiedByKey.get(candidateKey(c));
            const isWeak = c.raw_confidence < 0.5;
            return (
              <div
                key={`${c.timestamp_s}-${c.work_title}-${i}`}
                className={`${CARD_BASE} ${
                  isWeak
                    ? "border border-dashed border-[color:color-mix(in_oklab,var(--grad-sky)_35%,transparent)]"
                    : "border border-hairline"
                }`}
                style={{ animationDelay: `${Math.min(i * 80, 800)}ms` }}
              >
                <div
                  className={HAIRLINE}
                  style={{
                    color: isWeak ? "var(--grad-sky)" : "var(--grad-peach)",
                  }}
                >
                  {formatTimecode(c.timestamp_s)} ·{" "}
                  {isWeak ? "weak signal" : "candidate"}
                </div>
                <div className="font-serif font-light not-italic tracking-[-0.01em] mt-0.5 text-ink text-[15px] leading-tight">
                  {c.work_title}
                </div>
                <div className={`${HAIRLINE} mt-0.5`}>
                  {c.work_creator}
                  {c.work_year ? `, ${c.work_year}` : ""}
                </div>
                <div
                  className={`${HAIRLINE} mt-1.5 ${
                    verdict ? VERIFY_COLOR[verdict] : "text-muted-soft"
                  }`}
                >
                  {verdict ? VERIFY_LABEL[verdict] : "awaiting verify ◌"}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
