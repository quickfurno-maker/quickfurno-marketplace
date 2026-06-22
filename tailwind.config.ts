import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Copper & Charcoal editorial brand. Legacy keys ("navy"/"gold") retained
        // for compatibility with existing utility usage; values now map to the kit
        // palette (charcoal shell, copper accent). New work can use the `qf.*` keys.
        navy:   { DEFAULT: "#111111", deep: "#1C1917", ink: "#171412" },
        gold:   { DEFAULT: "#C67821", soft: "#E1942C", deep: "#9A5E16" },
        ivory:  "#F8EFE3",
        muted:  "#7A6B5C",
        // Kit canonical design tokens.
        qf: {
          charcoal: "#111111",
          charcoalSoft: "#1C1917",
          brown: "#4A2F1D",
          copper: "#C67821",
          copperLight: "#E1942C",
          copperDeep: "#9A5E16",
          cream: "#FFF8EF",
          ivory: "#F8EFE3",
          beige: "#ECE6D6",
          taupe: "#C9B8A4",
          text: "#171412",
          muted: "#7A6B5C",
          border: "#E8D7C4",
          success: "#19A55A",
        },
      },
      fontFamily: {
        display: ["var(--font-playfair)", "Cormorant Garamond", "Georgia", "serif"],
        serif:   ["var(--font-playfair)", "Cormorant Garamond", "Georgia", "serif"],
        sans:    ["var(--font-manrope)", "var(--font-jakarta)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        lift: "0 24px 60px -20px rgba(0,0,0,0.55)",
        gold: "0 0 0 1px rgba(198,120,33,0.35), 0 18px 40px -18px rgba(198,120,33,0.4)",
      },
      borderRadius: { xl2: "1.25rem" },
    },
  },
  plugins: [],
};
export default config;
