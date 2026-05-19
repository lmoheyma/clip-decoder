import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

export default function ReportNotFound() {
  return (
    <main className="relative overflow-hidden bg-canvas text-ink min-h-screen min-h-[100dvh] flex flex-col">
      <div aria-hidden className="aurora" />
      <div aria-hidden className="aurora aurora-b" />
      <div aria-hidden className="grain" />

      <div className="relative z-[2] flex flex-col flex-1 min-h-0">
        <div className="slate relative z-[2] flex items-center gap-[18px] px-[clamp(28px,4vw,56px)] py-[22px] max-sm:px-5 max-sm:py-[14px] max-sm:gap-3 font-sans text-sm text-body tracking-[0.14px]">
          <BrandMark />
          <b className="font-serif not-italic font-normal text-[22px] leading-none tracking-[-0.015em] text-ink [font-variation-settings:'SOFT'_100]">
            ClipDecoder
          </b>
          <span className="flex-1 h-px" />
        </div>

        <section className="flex-1 w-full max-w-[1240px] mx-auto flex flex-col justify-center items-center text-center gap-8 py-[clamp(24px,4vh,56px)] px-[clamp(24px,3vw,48px)]">
          <h1 className="m-0 font-serif font-light text-ink leading-[0.96] tracking-[-0.028em] text-[clamp(56px,8.4vw,132px)] [font-variation-settings:'SOFT'_100]">
            No <em className="italic font-normal text-grad-lavender [font-variation-settings:'SOFT'_100]">report</em>
            <br />
            with that id.
            <span className="block not-italic font-light font-serif text-body mt-11 tracking-[-0.005em] text-[0.28em] [font-variation-settings:'SOFT'_50]">
              The clip was never analyzed, or its record was cleared.
            </span>
          </h1>

          <Link
            href="/"
            className="inline-block px-[22px] py-3 rounded-full border border-hairline-strong font-sans text-[11px] uppercase tracking-[0.14em] text-body no-underline transition-colors duration-200 hover:text-ink hover:border-ink"
          >
            ← Analyze a new clip
          </Link>
        </section>
      </div>
    </main>
  );
}
