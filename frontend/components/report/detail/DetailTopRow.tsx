"use client";
import type { VerifiedReference } from "@/lib/types";

const VERDICT_DOT: Record<string, string> = {
  confirmed: "var(--grad-peach)",
  speculative: "var(--grad-sky)",
  hidden: "var(--muted)",
};

export function DetailTopRow({
  reference,
}: {
  reference: VerifiedReference;
}) {
  const verdictLabel = reference.final_confidence.toUpperCase();
  return (
    <div className="flex items-baseline justify-between gap-6">
      <div>
        <div className="mb-2 font-sans text-[12px] font-semibold uppercase tracking-uc text-muted">
          <span style={{ color: VERDICT_DOT[reference.final_confidence] }}>● {verdictLabel}</span>
          &nbsp; · &nbsp; {reference.work_type.toUpperCase()}
          {reference.wikipedia_url && (
            <>&nbsp; · &nbsp; WIKIPEDIA VERIFIED</>
          )}
          &nbsp; · &nbsp; CONFIDENCE {reference.raw_confidence.toFixed(2)}
        </div>
        <h1 className="m-0 font-serif italic font-normal text-ink leading-tight tracking-[-0.025em] text-[clamp(36px,4vw,48px)]">
          {reference.work_title}
          <span className="not-italic text-body">
            {" "}— {reference.work_creator}
            {reference.work_year !== null ? `, ${reference.work_year}` : ""}
          </span>
        </h1>
      </div>
    </div>
  );
}
