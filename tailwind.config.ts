import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Beige editorial brand. Keys ("navy"/"gold") retained for compatibility
        // with existing utility usage; values are the warm palette.
        navy:   { DEFAULT: "#171412", deep: "#221C15", ink: "#181512" },
        gold:   { DEFAULT: "#B8874A", soft: "#C9A066", deep: "#9A6E37" },
        ivory:  "#F7F1E8",
        muted:  "#70675D",
      },
      fontFamily: {
        display: ["var(--font-playfair)", "Cormorant Garamond", "Georgia", "serif"],
        serif:   ["var(--font-playfair)", "Cormorant Garamond", "Georgia", "serif"],
        sans:    ["var(--font-manrope)", "var(--font-jakarta)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        lift: "0 24px 60px -20px rgba(0,0,0,0.55)",
        gold: "0 0 0 1px rgba(184,135,74,0.35), 0 18px 40px -18px rgba(184,135,74,0.4)",
      },
      borderRadius: { xl2: "1.25rem" },
    },
  },
  plugins: [],
};
export default config;
