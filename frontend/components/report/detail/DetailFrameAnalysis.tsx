"use client";
import type { FrameAnalysis } from "@/lib/types";

export function DetailFrameAnalysis({
  frame,
  rawConfidence,
}: {
  frame: FrameAnalysis | undefined;
  rawConfidence: number;
}) {
  if (!frame) {
    return (
      <div className="detail-frame-analysis">
        <div className="h">Frame analysis</div>
        <p className="hairline">Frame analysis unavailable.</p>
      </div>
    );
  }
  const paletteLabel = frame.palette.join(" → ").toUpperCase();
  const paletteHex = frame.palette_hex ?? [];
  return (
    <div className="detail-frame-analysis">
      <div className="h">Frame analysis</div>
      <dl>
        <div>
          <dt>Composition</dt>
          <dd>{frame.composition}</dd>
        </div>
        <div>
          <dt>Palette</dt>
          <dd>
            <div className="palette-row">
              {paletteHex.map((hex, i) => (
                <span key={i} className="swatch" style={{ background: hex }} />
              ))}
              <span className="label">{paletteLabel}</span>
            </div>
          </dd>
        </div>
        <div>
          <dt>Camera</dt>
          <dd>{frame.camera_move}</dd>
        </div>
        <div>
          <dt>Costume / Setting</dt>
          <dd>{frame.costume_setting}</dd>
        </div>
        <div>
          <dt>Distinctive features</dt>
          <dd>{frame.distinctive_features.join(", ") || "—"}</dd>
        </div>
        <div>
          <dt>Vision confidence</dt>
          <dd>
            {rawConfidence.toFixed(2)}{" "}
            <span className="hairline" style={{ marginLeft: 8 }}>
              (raw observation, pre-verify)
            </span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
