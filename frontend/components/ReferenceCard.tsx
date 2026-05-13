"use client";
import Link from "next/link";
import type { VerifiedReference } from "@/lib/types";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

const VERDICT_META: Record<
  string,
  { label: string; icon: string; chipExtra: string; confExtra: string }
> = {
  confirmed: { label: "CONFIRMED", icon: "●", chipExtra: "", confExtra: "" },
  speculative: { label: "SPECULATIVE", icon: "◌", chipExtra: "chip-cyan", confExtra: "conf-cyan" },
  hidden: { label: "HIDDEN", icon: "✕", chipExtra: "chip-dim", confExtra: "conf-rose" },
};

export function ReferenceCard({
  reference,
  index,
  paletteHex,
  paletteDescriptors,
  youtubeId,
  onJump,
  onFlag,
}: {
  reference: VerifiedReference;
  index: number;
  paletteHex: string[];
  paletteDescriptors: string[];
  youtubeId: string;
  onJump: () => void;
  onFlag: () => void;
}) {
  const verdict = reference.final_confidence;
  const meta = VERDICT_META[verdict];
  const tc = formatTimecode(reference.timestamp_s);
  const isHidden = verdict === "hidden";
  const confPercent = Math.round(reference.raw_confidence * 100);
  const detailHref = `/report/${youtubeId}/ref/${index}`;

  return (
    <article className={`ref ref-${verdict}`}>
      {/* Visual region — clickable Link to the detail page. */}
      <Link
        href={detailHref}
        className="ref-link"
        aria-label={`Open detail for ${reference.work_title} at ${tc}`}
      >
        <div className="ref-left">
          <div
            className="thumb"
            style={{
              backgroundImage: `url(/api/frames/${youtubeId}/${reference.source_frame_id})`,
              filter: isHidden ? "grayscale(0.7) brightness(0.6)" : undefined,
            }}
          >
            <span className="tc-overlay">
              {tc} · {reference.source_frame_id.toUpperCase()}
            </span>
          </div>
          {paletteHex.length > 0 && (
            <>
              <div
                className="palette"
                style={{ marginTop: 8, opacity: isHidden ? 0.4 : 1 }}
              >
                {paletteHex.map((hex, i) => (
                  <span key={i} style={{ background: hex }} />
                ))}
              </div>
              {paletteDescriptors.length > 0 && (
                <div className="hairline palette-label">
                  PALETTE · {paletteDescriptors.join(" → ").toUpperCase()}
                </div>
              )}
            </>
          )}
        </div>

        <div className="ref-right">
          <div className="ref-verdict-line">
            <span className={`verdict-marker verdict-${verdict}`}>
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

          <div className="ref-title-row">
            <h3
              className={`serif-it ref-title ${isHidden ? "ref-title-rejected" : ""}`}
            >
              <em>{reference.work_title}</em>
            </h3>
            {reference.wikipedia_thumbnail_url && (
              <img
                src={reference.wikipedia_thumbnail_url}
                alt=""
                className="wiki-thumb"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
          </div>

          <div className="ref-meta">
            {reference.work_creator} · {reference.work_year ?? "—"} ·{" "}
            {reference.work_type}
          </div>

          <p className="ref-reasoning">{reference.cross_ref_reasoning}</p>

          {reference.supporting_elements.length > 0 && (
            <div className="ev">
              {reference.supporting_elements.map((el, i) => (
                <span key={i} className={`chip ${meta.chipExtra}`}>
                  {el}
                </span>
              ))}
            </div>
          )}

          <div className={`conf ${meta.confExtra}`}>
            <span>CONFIDENCE</span>
            <span className="bar">
              <i style={{ width: `${confPercent}%` }} />
            </span>
            <span>{reference.raw_confidence.toFixed(2)}</span>
          </div>
        </div>
      </Link>

      {/* Action row — sits outside the Link so anchors/buttons here do not
          nest inside another <a>. */}
      <div className="ref-actions">
        <button
          type="button"
          className="ulink"
          onClick={onJump}
        >
          ▸ JUMP TO {tc}
        </button>
        {reference.wikipedia_url && (
          <a
            className="ulink"
            href={reference.wikipedia_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            WIKIPEDIA ↗
          </a>
        )}
        {!isHidden && (
          <button
            type="button"
            className="ulink ulink-muted"
            onClick={onFlag}
          >
            NOT CONVINCED ✕
          </button>
        )}
      </div>
    </article>
  );
}
