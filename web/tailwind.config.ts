import type { Config } from "tailwindcss";

// Colors are CSS variables (see globals.css) so light/dark themes swap in one place.
const v = (name: string) => `var(--${name})`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: v("paper"),
        card: { DEFAULT: v("card"), 2: v("card-2") },
        ink: { DEFAULT: v("ink"), 2: v("ink-2"), 3: v("ink-3") },
        line: v("line"),
        outline: v("outline"),
        up: { DEFAULT: v("green"), ink: v("green-ink"), soft: v("green-soft") },
        down: { DEFAULT: v("red"), ink: v("red-ink"), soft: v("red-soft") },
        lime: v("lime"),
        sky: v("sky"),
        pink: v("pink"),
        sun: v("sun"),
        lilac: v("lilac"),
        orange: v("orange"),
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", '"SF Pro Text"', "var(--font-sans)", "system-ui", "sans-serif"],
        display: ["-apple-system", "BlinkMacSystemFont", '"SF Pro Display"', "var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", '"SF Mono"', "var(--font-mono)", "monospace"],
      },
      borderRadius: { "4xl": "2rem" },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04), 0 8px 28px rgba(0,0,0,0.05)",
        lift: "0 2px 4px rgba(0,0,0,0.05), 0 16px 40px rgba(0,0,0,0.08)",
        sticker: "3px 3px 0 0 var(--outline)",
        "sticker-sm": "2px 2px 0 0 var(--outline)",
      },
      keyframes: {
        marquee: { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
        pop: { "0%": { transform: "scale(0.96)", opacity: "0" }, "100%": { transform: "scale(1)", opacity: "1" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        shake: { "0%,100%": { transform: "rotate(0)" }, "25%": { transform: "rotate(-2deg)" }, "75%": { transform: "rotate(2deg)" } },
      },
      animation: {
        marquee: "marquee 60s linear infinite",
        pop: "pop 240ms cubic-bezier(0.2, 0.9, 0.3, 1.2)",
        float: "float 5s ease-in-out infinite",
        shake: "shake 400ms ease-in-out",
      },
    },
  },
  plugins: [],
};

export default config;
