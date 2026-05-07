// Mirror of DESIGN.md tokens. Keep this file in sync with the spec.
export const COLORS = {
  brandMagenta: "#ef2cc1",
  brandOrange: "#fc4c02",
  darkBlue: "#010120",
  softLavender: "#bdbbff",
  pureWhite: "#ffffff",
  pureBlack: "#000000",
  black8: "rgba(0, 0, 0, 0.08)",
  black40: "rgba(0, 0, 0, 0.40)",
  white12: "rgba(255, 255, 255, 0.12)",
  glassLight: "rgba(255, 255, 255, 0.12)",
  glassDark: "rgba(0, 0, 0, 0.08)",
  shadowMidnight: "rgba(1, 1, 32, 0.1)",
} as const;

export const RADIUS = { sharp: "4px", comfy: "8px" } as const;
export const SHADOW = {
  midnight: "0px 4px 10px rgba(1, 1, 32, 0.1)",
} as const;

export const TYPE = {
  display: { fontSize: "64px", lineHeight: "1.05", letterSpacing: "-1.92px" },
  h2:      { fontSize: "40px", lineHeight: "1.20", letterSpacing: "-0.8px" },
  h3:      { fontSize: "28px", lineHeight: "1.15", letterSpacing: "-0.42px" },
  feature: { fontSize: "22px", lineHeight: "1.15", letterSpacing: "-0.22px" },
  bodyLg:  { fontSize: "18px", lineHeight: "1.30", letterSpacing: "-0.18px" },
  body:    { fontSize: "16px", lineHeight: "1.30", letterSpacing: "-0.16px" },
  caption: { fontSize: "14px", lineHeight: "1.40", letterSpacing: "0px" },
  monoLabel: { fontSize: "11px", lineHeight: "1.40", letterSpacing: "0.055px" },
} as const;
