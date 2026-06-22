import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Indigo & Coral brand. Keys ("navy"/"gold") retained for compatibility
        // with existing utility usage; values are the new palette.
        navy:   { DEFAULT: "#4F46E5", deep: "#312A6B", ink: "#1E1B3A" },
        gold:   { DEFAULT: "#FF6B5A", soft: "#FF8A7A", deep: "#E0493A" },
        ivory:  "#F7F7FB",
        muted:  "#5B5670",
      },
      fontFamily: {
        display: ["var(--font-jakarta)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans:    ["var(--font-jakarta)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        lift: "0 24px 60px -20px rgba(0,0,0,0.55)",
        gold: "0 0 0 1px rgba(255,107,90,0.35), 0 18px 40px -18px rgba(255,107,90,0.4)",
      },
      borderRadius: { xl2: "1.25rem" },
    },
  },
  plugins: [],
};
export default config;
