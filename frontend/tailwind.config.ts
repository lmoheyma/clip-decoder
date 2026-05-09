import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { magenta: "#ef2cc1", orange: "#fc4c02" },
        midnight: "#010120",
        "midnight-deep": "#00000d",
        lavender: "#bdbbff",
        mist: "#f5f1ff",
      },
      borderRadius: { sharp: "4px", comfy: "8px" },
      boxShadow: {
        midnight: "0px 4px 10px rgba(1, 1, 32, 0.10)",
        "midnight-soft": "0px 24px 60px -20px rgba(1, 1, 32, 0.18)",
      },
      fontFamily: {
        display: ["var(--font-bricolage)", "The Future", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["var(--font-plex-mono)", "PP Neue Montreal Mono", "ui-monospace", "Menlo", "monospace"],
      },
      letterSpacing: {
        display: "-0.030em",
        h2: "-0.020em",
        h3: "-0.012em",
        body: "-0.010em",
        monoLabel: "0.08em",
      },
    },
  },
};
export default config;
