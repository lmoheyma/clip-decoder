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
    <div className="detail-top">
      <div>
        <div className="hairline" style={{ marginBottom: 8 }}>
          <span style={{ color: VERDICT_DOT[reference.final_confidence] }}>● {verdictLabel}</span>
          &nbsp; · &nbsp; {reference.work_type.toUpperCase()}
          {reference.wikipedia_url && (
            <>&nbsp; · &nbsp; WIKIPEDIA VERIFIED</>
          )}
          &nbsp; · &nbsp; CONFIDENCE {reference.raw_confidence.toFixed(2)}
        </div>
        <h1>
          {reference.work_title}
          <span className="by">
            {" "}— {reference.work_creator}
            {reference.work_year !== null ? `, ${reference.work_year}` : ""}
          </span>
        </h1>
      </div>
    </div>
  );
}
