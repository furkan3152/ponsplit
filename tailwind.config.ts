import type { Config } from "tailwindcss";

// Colors are CSS variables (see globals.css) so the dark and light themes swap in one place.
const v = (name: string) => `var(--${name})`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // Themes are chosen on <html data-theme> (dark by default), not by the OS setting.
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        paper: v("paper"),
        card: { DEFAULT: v("card"), 2: v("card-2"), 3: v("card-3") },
        ink: { DEFAULT: v("ink"), 2: v("ink-2"), 3: v("ink-3") },
        line: { DEFAULT: v("line"), 2: v("line-2") },
        outline: v("outline"),
        up: { DEFAULT: v("green"), ink: v("green-ink"), soft: v("green-soft") },
        down: { DEFAULT: v("red"), ink: v("red-ink"), soft: v("red-soft") },
        lime: { DEFAULT: v("lime"), ink: v("lime-ink"), soft: v("lime-soft") },
        neon: v("lime"),
        sky: v("sky"),
        pink: v("pink"),
        sun: v("sun"),
        lilac: v("lilac"),
        orange: v("orange"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SF Mono", "monospace"],
      },
      borderRadius: { "4xl": "2rem" },
      boxShadow: {
        card: "var(--card-edge)",
        lift: "0 2px 4px rgba(0,0,0,0.05), 0 16px 40px rgba(0,0,0,0.12)",
        glow: "0 0 0 1px var(--lime-soft), 0 18px 48px -16px var(--glow)",
        sticker: "3px 3px 0 0 var(--outline)",
        "sticker-sm": "2px 2px 0 0 var(--outline)",
      },
      keyframes: {
        marquee: { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
        pop: { "0%": { transform: "scale(0.96)", opacity: "0" }, "100%": { transform: "scale(1)", opacity: "1" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-8px)" } },
        shake: { "0%,100%": { transform: "rotate(0)" }, "25%": { transform: "rotate(-2deg)" }, "75%": { transform: "rotate(2deg)" } },
        // Streams of fees: dashes travel along SVG paths.
        flow: { to: { strokeDashoffset: "-48" } },
        // SVG strokes that draw themselves (set stroke-dasharray/offset to the path length).
        draw: { to: { strokeDashoffset: "0" } },
        shine: { from: { transform: "translateX(-160%) skewX(-20deg)" }, to: { transform: "translateX(360%) skewX(-20deg)" } },
        "pulse-dot": {
          "0%": { boxShadow: "0 0 0 0 var(--glow)" },
          "70%": { boxShadow: "0 0 0 7px transparent" },
          "100%": { boxShadow: "0 0 0 0 transparent" },
        },
        "flash-up": { "0%": { backgroundColor: "var(--green-soft)", color: "var(--green-ink)" }, "100%": { backgroundColor: "transparent" } },
        "flash-down": { "0%": { backgroundColor: "var(--red-soft)", color: "var(--red-ink)" }, "100%": { backgroundColor: "transparent" } },
        "slide-up": { from: { transform: "translateY(10px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        stamp: {
          "0%": { transform: "scale(1.8) rotate(-14deg)", opacity: "0" },
          "60%": { transform: "scale(0.94) rotate(-6deg)", opacity: "1" },
          "100%": { transform: "scale(1) rotate(-6deg)", opacity: "1" },
        },
        "spin-slow": { to: { transform: "rotate(360deg)" } },
        wiggle: { "0%,100%": { transform: "rotate(-3deg)" }, "50%": { transform: "rotate(3deg)" } },
        shimmer: { from: { backgroundPosition: "200% 0" }, to: { backgroundPosition: "-200% 0" } },
      },
      animation: {
        marquee: "marquee 70s linear infinite",
        pop: "pop 240ms cubic-bezier(0.2, 0.9, 0.3, 1.2)",
        float: "float 6s ease-in-out infinite",
        shake: "shake 400ms ease-in-out",
        flow: "flow 1.6s linear infinite",
        draw: "draw 1.4s cubic-bezier(0.6, 0, 0.2, 1) forwards",
        shine: "shine 2.8s ease-in-out infinite",
        "pulse-dot": "pulse-dot 1.8s ease-out infinite",
        "flash-up": "flash-up 1.2s ease-out",
        "flash-down": "flash-down 1.2s ease-out",
        "slide-up": "slide-up 360ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        stamp: "stamp 520ms cubic-bezier(0.2, 0.9, 0.3, 1.2) forwards",
        "spin-slow": "spin-slow 40s linear infinite",
        wiggle: "wiggle 2.4s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
