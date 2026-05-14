"use client";
import type { VerifiedReference } from "@/lib/types";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

const VERDICT_DOT: Record<string, string> = {
  confirmed: "var(--grad-peach)",
  speculative: "var(--grad-sky)",
  hidden: "var(--muted)",
};

export function DetailTopRow({
  reference,
  onJump,
}: {
  reference: VerifiedReference;
  onJump: () => void;
}) {
  const verdictLabel = reference.final_confidence.toUpperCase();
  const tc = formatTimecode(reference.timestamp_s);
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
      <div className="detail-top-actions">
        <button type="button" className="btn" onClick={onJump}>
          JUMP ▸ {tc}
        </button>
      </div>
    </div>
  );
}
