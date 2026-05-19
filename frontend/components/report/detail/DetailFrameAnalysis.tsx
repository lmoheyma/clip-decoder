"use client";
import type { FrameAnalysis } from "@/lib/types";

const PANE =
  "bg-surface-card border border-hairline rounded-2 px-6 py-[22px]";

const PANE_H = "mb-3.5 font-serif italic text-sm text-muted";

const DT =
  "font-sans text-[11px] font-semibold uppercase tracking-uc text-muted";

const DD = "mt-0.5 m-0 font-sans text-[13px] leading-[1.5] text-ink";

export function DetailFrameAnalysis({
  frame,
  rawConfidence,
}: {
  frame: FrameAnalysis | undefined;
  rawConfidence: number;
}) {
  if (!frame) {
    return (
      <div className={PANE}>
        <div className={PANE_H}>Frame analysis</div>
        <p className="font-sans text-[12px] font-semibold uppercase tracking-uc text-muted">Frame analysis unavailable.</p>
      </div>
    );
  }
  const paletteLabel = frame.palette.join(" → ").toUpperCase();
  const paletteHex = frame.palette_hex ?? [];
  return (
    <div className={PANE}>
      <div className={PANE_H}>Frame analysis</div>
      <dl className="grid gap-3.5 m-0">
        <div>
          <dt className={DT}>Composition</dt>
          <dd className={DD}>{frame.composition}</dd>
        </div>
        <div>
          <dt className={DT}>Palette</dt>
          <dd className={DD}>
            <div className="flex flex-wrap items-center gap-1.5">
              {paletteHex.map((hex, i) => (
                <span
                  key={i}
                  className="w-[18px] h-[18px] rounded-[3px] border border-white/5"
                  style={{ background: hex }}
                />
              ))}
              <span className="font-sans text-[11px] tracking-[0.04em] text-muted">{paletteLabel}</span>
            </div>
          </dd>
        </div>
        <div>
          <dt className={DT}>Camera</dt>
          <dd className={DD}>{frame.camera_move}</dd>
        </div>
        <div>
          <dt className={DT}>Costume / Setting</dt>
          <dd className={DD}>{frame.costume_setting}</dd>
        </div>
        <div>
          <dt className={DT}>Distinctive features</dt>
          <dd className={DD}>{frame.distinctive_features.join(", ") || "—"}</dd>
        </div>
        <div>
          <dt className={DT}>Vision confidence</dt>
          <dd className={DD}>
            {rawConfidence.toFixed(2)}{" "}
            <span className="ml-2 font-sans text-[12px] font-semibold uppercase tracking-uc text-muted">
              (raw observation, pre-verify)
            </span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
