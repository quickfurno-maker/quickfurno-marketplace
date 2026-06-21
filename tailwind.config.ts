import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // "navy" tokens retained as keys for compatibility, now a premium deep-emerald scale.
        navy:   { DEFAULT: "#0E5A47", deep: "#093A2E", ink: "#06251D" },
        gold:   { DEFAULT: "#C9A227", soft: "#E6C65A", deep: "#8F6F12" },
        ivory:  "#F4F1EA",
        muted:  "#C2BCAD",
      },
      fontFamily: {
        display: ["var(--font-jakarta)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans:    ["var(--font-jakarta)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        lift: "0 24px 60px -20px rgba(0,0,0,0.55)",
        gold: "0 0 0 1px rgba(201,162,39,0.35), 0 18px 40px -18px rgba(201,162,39,0.4)",
      },
      borderRadius: { xl2: "1.25rem" },
    },
  },
  plugins: [],
};
export default config;
