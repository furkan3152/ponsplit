import { BugMark } from "./Bug";

/**
 * Splitdev brand mark: Bitbug, the split-shell beetle. `public/logo.svg` and `src/app/icon.svg` are
 * rendered from this (scripts/render-logo.mjs).
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return <BugMark size={size} className={className} />;
}

/** The wordmark text alone: "splitdev" in lowercase like a command, "dev" in tangerine, a blinking caret. */
export function WordmarkText({ className = "" }: { className?: string }) {
  return (
    <span className={`display whitespace-nowrap leading-none tracking-[-0.05em] ${className}`}>
      split<span className="text-neon">dev</span>
      <span aria-hidden className="caret ml-[1px] inline-block h-[0.14em] w-[0.5em] translate-y-[0.02em] rounded-[1px] bg-lime align-baseline" />
    </span>
  );
}

/** LogoMark + wordmark as a flex row. The bug turns a little when its link is hovered. */
export function Wordmark({ className, textClassName = "", size = 28 }: { className?: string; textClassName?: string; size?: number }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark size={size} className="transition-transform duration-500 group-hover:-rotate-12 group-hover:scale-110" />
      <WordmarkText className={`text-[21px] ${textClassName}`} />
    </span>
  );
}
