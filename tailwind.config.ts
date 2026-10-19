import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#050816", 900: "#080d20", 850: "#0b1229", 800: "#0f1733", 750: "#141d3d", 700: "#1b2549", 600: "#26315b", 500: "#3a4672" },
        calm: { 50: "#eef4ff", 100: "#dbe7ff", 200: "#bcd2ff", 300: "#9dbcff", 400: "#7ea5ff", 500: "#5f8bf5", 600: "#4a70d6", 700: "#3a59ad" },
        paper: { 50: "#fbf8f2", 100: "#f6f1e7", 200: "#ece4d3", 300: "#d9cdb4" },
        mist: { 100: "#e7ebf7", 200: "#c9d0e6", 300: "#9aa4c4", 400: "#76809f", 500: "#596282" },
        ok: "#5fd3a5",
        warn: "#f2c45f",
        bad: "#f2797a",
        violet: "#b39cff",
      },
      fontFamily: {
        sans: ["'Inter Variable'", "Inter", "system-ui", "sans-serif"],
        display: ["'Fraunces Variable'", "Fraunces", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(126,165,255,0.18), 0 20px 60px -30px rgba(95,139,245,0.55)",
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 40px -24px rgba(0,0,0,0.6)",
      },
      keyframes: {
        rise: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        pulseSoft: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.45" } },
      },
      animation: { rise: "rise .35s cubic-bezier(.2,.7,.2,1) both", pulseSoft: "pulseSoft 1.6s ease-in-out infinite" },
    },
  },
  plugins: [],
} satisfies Config;
