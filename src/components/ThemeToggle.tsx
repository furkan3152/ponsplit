"use client";

import { useTheme } from "@/lib/theme";

/** Switches between the dark house theme and the light paper edition; the choice is remembered. */
export function ThemeToggle({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to the ${next} theme`}
      className={`inline-flex items-center gap-2 rounded-full border border-line text-[13px] font-medium text-ink-2 transition hover:border-line-2 hover:text-ink ${
        compact ? "h-9 w-9 justify-center" : "px-3 py-1.5"
      } ${className}`}
    >
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
        </svg>
      )}
      {compact ? null : theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
