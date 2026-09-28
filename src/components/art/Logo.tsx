import { SplitCoin } from "./parts";

/** SplitEarn brand mark: a coin split diagonally into a lime and a green half. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <SplitCoin cx={15} cy={15} r={12.4} sw={2.2} gap={4.6} shadow={1.9} />
    </svg>
  );
}

/** LogoMark + "SplitEarn" wordmark as a flex row. The mark turns a little when its link is hovered. */
export function Wordmark({ className, textClassName = "", size = 28 }: { className?: string; textClassName?: string; size?: number }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark size={size} className="transition-transform duration-500 group-hover:-rotate-12 group-hover:scale-110" />
      <span className={`display text-[20px] leading-none ${textClassName}`}>SplitEarn</span>
    </span>
  );
}
