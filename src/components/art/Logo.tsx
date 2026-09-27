import { SplitCoin } from "./parts";

/** PonSplit brand mark: a coin split diagonally into a lime and a green half. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <SplitCoin cx={15} cy={15} r={12.4} sw={2.2} gap={4.6} shadow={1.9} />
    </svg>
  );
}

/** LogoMark + "PonSplit" wordmark as a flex row; text inherits the font. */
export function Wordmark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark size={size} />
      <span className="font-semibold tracking-tight">PonSplit</span>
    </span>
  );
}
