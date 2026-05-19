import Link from "next/link";
import { BrandMark } from "./BrandMark";

/**
 * Slate-corner cluster: the gradient mark + the "ClipDecoder" wordmark,
 * wrapped in a Link to the home page. Used by every slate (home,
 * not-found, pipeline, report, detail).
 */
export function BrandLink() {
  return (
    <Link
      href="/"
      aria-label="ClipDecoder — home"
      className="inline-flex items-center gap-[18px] max-sm:gap-3 no-underline text-inherit"
    >
      <BrandMark />
      <b className="font-serif not-italic font-normal text-[22px] leading-none tracking-[-0.015em] text-ink [font-variation-settings:'SOFT'_100]">
        ClipDecoder
      </b>
    </Link>
  );
}
