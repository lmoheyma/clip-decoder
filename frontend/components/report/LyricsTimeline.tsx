"use client";
import type { LyricLink } from "@/lib/types";

function formatTimecode(s: number): string {
  const t = Math.floor(s);
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

const RELATION_VARIANT: Record<string, string> = {
  literal:
    "bg-[color:color-mix(in_oklab,var(--grad-peach)_18%,var(--surface-strong))] border-[color:color-mix(in_oklab,var(--grad-peach)_30%,transparent)] text-grad-peach",
  motif:
    "bg-[color:color-mix(in_oklab,var(--grad-sky)_16%,var(--surface-strong))] border-[color:color-mix(in_oklab,var(--grad-sky)_30%,transparent)] text-grad-sky",
  contrast: "bg-surface-strong border-l-error border-hairline text-error",
  amplification: "bg-surface-strong border-hairline text-body",
  other: "bg-surface-strong border-hairline text-muted",
};

const CHIP =
  "inline-flex items-center px-2 py-[2px] rounded-full border font-sans text-[10px] font-semibold uppercase tracking-[0.06em]";

export function LyricsTimeline({
  links,
  youtubeId,
  onSeek,
}: {
  links: LyricLink[];
  youtubeId: string;
  onSeek: (t: number) => void;
}) {
  if (links.length === 0) return null;
  return (
    <ol className="relative z-[1] list-none m-0 p-0 flex flex-col gap-3 px-[clamp(32px,5vw,64px)] py-8">
      {links.map((link, i) => (
        <li key={`${link.frame_id}-${i}`}>
          <button
            type="button"
            aria-label={`${link.lyric} at ${formatTimecode(link.lyric_timestamp_s)}`}
            onClick={() => onSeek(link.lyric_timestamp_s)}
            className="w-full text-left grid grid-cols-[auto_88px_1fr] items-center gap-4 p-3 bg-surface-card border border-hairline rounded-2 transition-colors duration-200 hover:border-hairline-strong"
          >
            <span className="font-sans text-[11px] font-medium uppercase tracking-uc text-muted tabular-nums self-start pt-1">
              {formatTimecode(link.lyric_timestamp_s)}
            </span>
            <span
              className="aspect-video w-full bg-cover bg-center bg-surface-strong rounded-1"
              style={{
                backgroundImage: `url(/api/frames/${youtubeId}/${link.frame_id})`,
              }}
            />
            <span className="flex flex-col gap-1.5 min-w-0">
              <span className="flex items-center gap-2 flex-wrap">
                <em className="font-serif italic text-ink text-[clamp(15px,1.4vw,18px)] leading-snug">
                  &ldquo;{link.lyric}&rdquo;
                </em>
                <span
                  className={`${CHIP} ${RELATION_VARIANT[link.relation] ?? RELATION_VARIANT.other}`}
                >
                  {link.relation}
                </span>
              </span>
              <span className="font-sans text-[13px] leading-[1.5] text-body">
                {link.note}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
