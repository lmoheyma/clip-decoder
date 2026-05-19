"use client";

const PANE =
  "bg-surface-card border border-hairline rounded-2 px-6 py-[22px]";

const PANE_H =
  "mb-3.5 font-serif italic text-sm text-muted";

const PULL_QUOTE =
  "m-0 mb-7 font-serif italic text-[19px] leading-[1.45] text-ink border-l-2 border-grad-peach pl-4";

const PASS_BASE =
  "relative rounded-md py-3.5 px-4 pl-[18px] mb-[18px] last:mb-0 border-l-4";

const PASS_VARIANT: Record<string, { border: string; bg: string; num: string }> = {
  crossref: {
    border: "border-l-grad-peach",
    bg: "bg-[color:color-mix(in_oklab,var(--grad-peach)_9%,transparent)]",
    num: "text-grad-peach",
  },
  adversarial: {
    border: "border-l-grad-sky",
    bg: "bg-[color:color-mix(in_oklab,var(--grad-sky)_9%,transparent)]",
    num: "text-grad-sky",
  },
  wikipedia: {
    border: "border-l-grad-lavender",
    bg: "bg-[color:color-mix(in_oklab,var(--grad-lavender)_9%,transparent)]",
    num: "text-grad-lavender",
  },
};

const PASS_HEADER = "flex items-center gap-3 mb-2.5";

const PASS_NUM_BASE = "font-sans text-[22px] font-bold tracking-[-0.02em] leading-none";

const PASS_LBL =
  "font-sans text-[11px] font-semibold uppercase tracking-[1.2px] text-ink";

const PASS_P = "m-0 font-sans text-sm leading-[1.6] text-body-strong";

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
    <div className={PANE}>
      <div className={PANE_H}>EVIDENCE CHAIN · CROSS-REFERENCE → VERIFY</div>
      <p className={PULL_QUOTE}>{pull}</p>
      <section className={`${PASS_BASE} ${PASS_VARIANT.crossref.border} ${PASS_VARIANT.crossref.bg}`}>
        <header className={PASS_HEADER}>
          <span className={`${PASS_NUM_BASE} ${PASS_VARIANT.crossref.num}`}>01</span>
          <span className={PASS_LBL}>Cross-reference pass</span>
        </header>
        <p className={PASS_P}>{crossRef}</p>
      </section>
      <section className={`${PASS_BASE} ${PASS_VARIANT.adversarial.border} ${PASS_VARIANT.adversarial.bg}`}>
        <header className={PASS_HEADER}>
          <span className={`${PASS_NUM_BASE} ${PASS_VARIANT.adversarial.num}`}>02</span>
          <span className={PASS_LBL}>Adversarial pass</span>
        </header>
        <p className={PASS_P}>{adversarial}</p>
      </section>
      <section className={`${PASS_BASE} ${PASS_VARIANT.wikipedia.border} ${PASS_VARIANT.wikipedia.bg}`}>
        <header className={PASS_HEADER}>
          <span className={`${PASS_NUM_BASE} ${PASS_VARIANT.wikipedia.num}`}>03</span>
          <span className={PASS_LBL}>Wikipedia</span>
        </header>
        <p className={PASS_P}>{wikipedia}</p>
      </section>
    </div>
  );
}
