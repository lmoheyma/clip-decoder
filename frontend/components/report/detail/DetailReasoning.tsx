"use client";

/**
 * Extract the first sentence from a string, used for the pull-quote.
 * Greedy-stops at the first `.`, `!`, or `?` followed by whitespace or
 * end of string. If no terminator is found within 240 chars, slice to
 * 240 with an ellipsis fallback.
 */
export function extractPullQuote(text: string): string {
  const m = text.match(/^.*?[.!?](?:\s|$)/);
  if (m) return m[0].trim();
  if (text.length <= 240) return text;
  return text.slice(0, 239) + "…";
}

export function DetailReasoning({
  crossRef,
  adversarial,
  wikipedia,
}: {
  crossRef: string;
  adversarial: string;
  wikipedia: string;
}) {
  const pull = extractPullQuote(crossRef);
  return (
    <div className="detail-reasoning">
      <div className="h">EVIDENCE CHAIN · CROSS-REFERENCE → VERIFY</div>
      <p className="pull-quote">{pull}</p>
      <p>
        <span className="label">Cross-reference pass.</span>
        {crossRef}
      </p>
      <p>
        <span className="label">Adversarial pass.</span>
        {adversarial}
      </p>
      <p>
        <span className="label">Wikipedia.</span>
        {wikipedia}
      </p>
    </div>
  );
}
