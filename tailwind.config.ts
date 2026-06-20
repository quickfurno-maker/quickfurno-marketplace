import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy:   { DEFAULT: "#0A2471", deep: "#071A54", ink: "#050F33" },
        gold:   { DEFAULT: "#FFB909", soft: "#F6C453", deep: "#C98F00" },
        ivory:  "#F4EFE6",
        muted:  "#B9C0DC",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        sans:    ["var(--font-raleway)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        lift: "0 24px 60px -20px rgba(0,0,0,0.55)",
        gold: "0 0 0 1px rgba(255,185,9,0.35), 0 18px 40px -18px rgba(255,185,9,0.4)",
      },
      borderRadius: { xl2: "1.25rem" },
    },
  },
  plugins: [],
};
export default config;
