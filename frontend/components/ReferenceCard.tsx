"use client";
import type { VerifiedReference } from "@/lib/types";

export function ReferenceCard({
  reference,
  onJump,
  onFlag,
}: {
  reference: VerifiedReference;
  onJump: () => void;
  onFlag: () => void;
}) {
  const ts = Math.floor(reference.timestamp_s);
  const min = Math.floor(ts / 60);
  const sec = ts % 60;
  const isConfirmed = reference.final_confidence === "confirmed";
  const conf = Math.round(reference.raw_confidence * 100);

  return (
    <article
      className="group relative rounded-comfy bg-white/[0.03] border border-white/10 p-5 flex flex-col gap-3 transition-all hover:bg-white/[0.06] hover:border-white/20 hover:shadow-aurora"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="font-mono uppercase text-[10px] tracking-mono-label text-white/55 inline-flex items-center gap-2">
          <span className="block w-1 h-1 rounded-full bg-lavender" />
          {min}:{sec.toString().padStart(2, "0")}
        </span>
        <span
          className={[
            "font-mono uppercase text-[9px] tracking-mono-label px-2 py-1 rounded-sharp border",
            isConfirmed
              ? "border-lavender/60 text-lavender bg-lavender/5"
              : "border-white/15 text-white/55 bg-white/5",
          ].join(" ")}
        >
          {reference.final_confidence}
        </span>
      </header>

      <button
        onClick={onJump}
        className="text-left font-display text-[22px] tracking-h3 leading-[1.1] hover:text-lavender transition-colors"
      >
        {reference.work_title}
      </button>

      <p className="font-mono uppercase text-[10px] tracking-mono-label text-white/55">
        {reference.work_creator}
        {reference.work_year ? ` · ${reference.work_year}` : ""}
        {" · "}
        {reference.work_type}
      </p>

      <p className="text-[14px] leading-[1.45] text-white/75 tracking-body">
        {reference.reasoning}
      </p>

      {/* Raw-confidence micro-bar */}
      <div className="flex items-center gap-2 pt-1">
        <span className="font-mono uppercase text-[9px] tracking-mono-label text-white/40">
          conf
        </span>
        <div className="flex-1 h-[2px] bg-white/10 rounded-sharp overflow-hidden">
          <div
            className="h-full fill-aurora"
            style={{ width: `${conf}%` }}
          />
        </div>
        <span className="font-mono uppercase text-[9px] tracking-mono-label text-white/55 w-8 text-right">
          {conf}%
        </span>
      </div>

      {reference.supporting_elements.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 pt-1">
          {reference.supporting_elements.map((el, i) => (
            <li
              key={i}
              className="font-mono uppercase text-[9px] tracking-mono-label px-2 py-1 rounded-sharp border border-white/10 text-white/60 bg-white/[0.02]"
            >
              {el}
            </li>
          ))}
        </ul>
      )}

      <footer className="flex justify-between items-center pt-2 border-t border-white/8">
        {reference.wikipedia_url ? (
          <a
            href={reference.wikipedia_url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono uppercase text-[10px] tracking-mono-label text-lavender inline-flex items-center gap-1.5 hover:underline underline-offset-4"
          >
            Wikipedia <span aria-hidden>↗</span>
          </a>
        ) : (
          <span className="font-mono uppercase text-[10px] tracking-mono-label text-white/30">
            no external link
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onFlag(); }}
          className="font-mono uppercase text-[10px] tracking-mono-label text-white/55 hover:text-[#fc4c02] transition-colors"
        >
          ✕ Not convinced
        </button>
      </footer>
    </article>
  );
}
