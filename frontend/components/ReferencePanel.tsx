"use client";
import type { VerifiedReference } from "@/lib/types";
import { ReferenceCard } from "./ReferenceCard";

export function ReferencePanel({
  references,
  showSpeculative,
  onJump,
  onFlag,
}: {
  references: VerifiedReference[];
  showSpeculative: boolean;
  onJump: (ref: VerifiedReference) => void;
  onFlag: (refIndex: number) => void;
}) {
  const visible = references
    .map((ref, idx) => ({ ref, idx }))
    .filter(({ ref }) =>
      ref.final_confidence === "confirmed"
        ? true
        : ref.final_confidence === "speculative" && showSpeculative,
    );

  if (visible.length === 0) {
    return (
      <p className="text-[16px] text-white/60">
        No confirmed references found{showSpeculative ? "." : "; toggle 'Show speculative' to see thinner candidates."}
      </p>
    );
  }

  return (
    <aside className="flex flex-col gap-4 max-h-[80vh] overflow-y-auto pr-2">
      {visible.map(({ ref, idx }) => (
        <ReferenceCard
          key={idx}
          reference={ref}
          onJump={() => onJump(ref)}
          onFlag={() => onFlag(idx)}
        />
      ))}
    </aside>
  );
}
