import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0b0d0c", 900: "#111412", 800: "#171b18", 700: "#222824", 600: "#2f3732" },
        lime: { DEFAULT: "#ccff00", dim: "#a6cf00" },
        mute: "#8a948d",
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"], mono: ["var(--font-mono)", "monospace"] },
    },
  },
  plugins: [],
};

export default config;
