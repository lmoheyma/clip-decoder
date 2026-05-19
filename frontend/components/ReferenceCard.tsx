"use client";
import Link from "next/link";
import type { VerifiedReference } from "@/lib/types";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

const CHIP_TAG_BASE =
  "inline-flex items-center gap-1.5 px-2 py-[2px] rounded-full border font-sans text-[10px] font-semibold uppercase tracking-[0.06em]";

const CHIP_TAG_VARIANT: Record<string, string> = {
  confirmed: "bg-surface-strong border-hairline text-body",
  speculative:
    "bg-[color:color-mix(in_oklab,var(--grad-sky)_16%,var(--surface-strong))] border-[color:color-mix(in_oklab,var(--grad-sky)_30%,transparent)] text-grad-sky",
  hidden: "bg-surface-strong border-hairline text-muted",
};

const VERDICT_BORDER: Record<string, string> = {
  confirmed: "border-l-grad-peach",
  speculative: "border-l-grad-sky opacity-95",
  hidden: "border-l-error opacity-70",
};

const VERDICT_MARKER: Record<string, string> = {
  confirmed: "text-grad-peach",
  speculative: "text-grad-sky",
  hidden: "text-error",
};

const CONF_BAR_FILL: Record<string, string> = {
  confirmed: "bg-grad-peach",
  speculative: "bg-grad-sky",
  hidden: "bg-error",
};

const VERDICT_META: Record<string, { label: string; icon: string }> = {
  confirmed: { label: "CONFIRMED", icon: "●" },
  speculative: { label: "SPECULATIVE", icon: "◌" },
  hidden: { label: "HIDDEN", icon: "✕" },
};

const ULINK =
  "font-sans text-[11px] font-medium uppercase tracking-uc text-ink no-underline border-b border-hairline-strong pb-0.5 cursor-pointer transition-[border-color] duration-200 hover:border-ink";

export function ReferenceCard({
  reference,
  index,
  paletteHex,
  paletteDescriptors,
  youtubeId,
  onJump,
}: {
  reference: VerifiedReference;
  index: number;
  paletteHex: string[];
  paletteDescriptors: string[];
  youtubeId: string;
  onJump: () => void;
}) {
  const verdict = reference.final_confidence;
  const meta = VERDICT_META[verdict];
  const tc = formatTimecode(reference.timestamp_s);
  const isHidden = verdict === "hidden";
  const confPercent = Math.round(reference.raw_confidence * 100);
  const detailHref = `/report/${youtubeId}/ref/${index}`;

  return (
    <article
      className={`ref relative grid grid-cols-1 sm:grid-cols-[1fr_1.4fr] gap-4 p-4 bg-surface-card border border-hairline border-l-2 rounded-2 transition-colors duration-200 hover:border-hairline-strong ${VERDICT_BORDER[verdict]}`}
    >
      <div className="contents">
        <div className="flex flex-col gap-1.5">
          <div
            className="aspect-video w-full bg-cover bg-center bg-surface-strong rounded-1 relative"
            style={{
              backgroundImage: `url(/api/frames/${youtubeId}/${reference.source_frame_id})`,
              filter: isHidden ? "grayscale(0.7) brightness(0.6)" : undefined,
            }}
          >
            <span className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 font-sans text-[11px] font-medium uppercase tracking-uc text-ink rounded">
              {tc} · {reference.source_frame_id.toUpperCase()}
            </span>
          </div>
          {paletteHex.length > 0 && (
            <>
              <div
                className="flex gap-1 h-6 mt-2"
                style={{ opacity: isHidden ? 0.4 : 1 }}
              >
                {paletteHex.map((hex, i) => (
                  <span key={i} className="flex-1 h-full rounded" style={{ background: hex }} />
                ))}
              </div>
              {paletteDescriptors.length > 0 && (
                <div className="mt-1.5 font-sans font-semibold uppercase text-[11px] tracking-[0.88px] text-muted">
                  PALETTE · {paletteDescriptors.join(" → ").toUpperCase()}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2.5 font-sans text-[11px] uppercase tracking-uc text-muted">
            <span className={`font-semibold ${VERDICT_MARKER[verdict]}`}>
              {meta.icon} {meta.label}
            </span>
            <span>·</span>
            <span>{reference.work_type}</span>
            {reference.wikipedia_url && (
              <>
                <span>·</span>
                <span>Wikipedia verified</span>
              </>
            )}
          </div>

          <div className="flex justify-between items-start gap-3">
            <h3
              className={`m-0 font-serif font-light not-italic text-ink leading-[1.2] tracking-[-0.15px] text-[clamp(17px,1.5vw,22px)] ${isHidden ? "line-through decoration-error decoration-1" : ""}`}
            >
              <em className="italic">{reference.work_title}</em>
            </h3>
            {reference.wikipedia_thumbnail_url && (
              <img
                src={reference.wikipedia_thumbnail_url}
                alt=""
                className="w-[60px] h-[60px] rounded-1 object-cover opacity-85 shrink-0 transition-opacity duration-200 hover:opacity-100"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
          </div>

          <div className="font-sans text-[11px] uppercase tracking-uc text-muted">
            {reference.work_creator} · {reference.work_year ?? "—"} ·{" "}
            {reference.work_type}
          </div>

          <p className="m-0 font-sans text-[13px] leading-[1.5] text-body max-w-[60ch] line-clamp-3">
            {reference.cross_ref_reasoning}
          </p>

          {reference.supporting_elements.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {reference.supporting_elements.map((el, i) => (
                <span key={i} className={`${CHIP_TAG_BASE} ${CHIP_TAG_VARIANT[verdict] ?? CHIP_TAG_VARIANT.confirmed}`}>
                  {el}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 font-sans text-[11px] uppercase tracking-uc text-muted">
            <span>CONFIDENCE</span>
            <span className="flex-1 h-0.5 bg-hairline rounded-full overflow-hidden">
              <i className={`block h-full ${CONF_BAR_FILL[verdict]}`} style={{ width: `${confPercent}%` }} />
            </span>
            <span>{reference.raw_confidence.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Action row spans both grid columns so the Details link can sit
          flush right while JUMP / WIKIPEDIA stay on the left. */}
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3.5 mt-1.5">
        <button type="button" className={ULINK} onClick={onJump}>
          ▸ JUMP TO {tc}
        </button>
        {reference.wikipedia_url && (
          <a
            className={ULINK}
            href={reference.wikipedia_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            WIKIPEDIA ↗
          </a>
        )}
        <Link
          href={detailHref}
          className={`${ULINK} ml-auto`}
          aria-label={`Open detail for ${reference.work_title} at ${tc}`}
        >
          DETAILS →
        </Link>
      </div>
    </article>
  );
}
