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
      <section className="pass pass-crossref">
        <header>
          <span className="num">01</span>
          <span className="lbl">Cross-reference pass</span>
        </header>
        <p>{crossRef}</p>
      </section>
      <section className="pass pass-adversarial">
        <header>
          <span className="num">02</span>
          <span className="lbl">Adversarial pass</span>
        </header>
        <p>{adversarial}</p>
      </section>
      <section className="pass pass-wikipedia">
        <header>
          <span className="num">03</span>
          <span className="lbl">Wikipedia</span>
        </header>
        <p>{wikipedia}</p>
      </section>
    </div>
  );
}
