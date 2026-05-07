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
  return (
    <div className="rounded-comfy bg-white/[0.03] border border-white/12 shadow-midnight p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-mono uppercase text-[11px] tracking-mono-label text-white/60">
          {min}:{sec.toString().padStart(2, "0")}
        </span>
        <span
          className={`font-mono uppercase text-[11px] tracking-mono-label px-2 py-1 rounded-sharp border ${
            reference.final_confidence === "confirmed"
              ? "border-lavender text-lavender"
              : "border-white/30 text-white/60"
          }`}
        >
          {reference.final_confidence}
        </span>
      </div>
      <button
        onClick={onJump}
        className="text-left font-display text-[22px] tracking-[-0.22px] leading-[1.15] hover:underline"
      >
        {reference.work_title}
      </button>
      <p className="text-[14px] text-white/70">
        {reference.work_creator}
        {reference.work_year ? ` · ${reference.work_year}` : ""}
        {" · "}
        {reference.work_type}
      </p>
      <p className="text-[14px] text-white/80">{reference.reasoning}</p>
      {reference.supporting_elements.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {reference.supporting_elements.map((el, i) => (
            <li
              key={i}
              className="font-mono uppercase text-[11px] tracking-mono-label px-2 py-1 rounded-sharp border border-white/12 text-white/60"
            >
              {el}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-between items-center">
        {reference.wikipedia_url ? (
          <a
            href={reference.wikipedia_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[14px] underline text-lavender"
          >
            Wikipedia
          </a>
        ) : (
          <span className="text-[14px] text-white/40">No external link</span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onFlag(); }}
          className="font-mono uppercase text-[11px] tracking-mono-label text-white/60 hover:text-brand-orange"
        >
          ✕ Not convinced
        </button>
      </div>
    </div>
  );
}
