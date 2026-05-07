import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { magenta: "#ef2cc1", orange: "#fc4c02" },
        midnight: "#010120",
        lavender: "#bdbbff",
      },
      borderRadius: { sharp: "4px", comfy: "8px" },
      boxShadow: { midnight: "0px 4px 10px rgba(1, 1, 32, 0.1)" },
      fontFamily: {
        display: ["The Future", "Arial", "sans-serif"],
        mono: ["PP Neue Montreal Mono", "Georgia", "monospace"],
      },
      letterSpacing: {
        display: "-1.92px",
        h2: "-0.8px",
        h3: "-0.42px",
        body: "-0.16px",
        monoLabel: "0.055px",
      },
    },
  },
};
export default config;
