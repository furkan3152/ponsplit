import { formatEther, formatUnits } from "viem";

export function formatEth(wei: bigint, digits = 4): string {
  const n = Number(formatEther(wei));
  if (n === 0) return "0";
  if (n < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}`;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatTokens(amount: bigint, digits = 2): string {
  const n = Number(formatUnits(amount, 18));
  return new Intl.NumberFormat("en-US", { notation: n >= 1e6 ? "compact" : "standard", maximumFractionDigits: digits }).format(n);
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const pct = (bps: number | bigint) => `${(Number(bps) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** Spot price in ETH per whole token from the curve's virtual reserves. */
export function spotPrice(virtualEth: bigint, virtualToken: bigint): number {
  if (virtualToken === 0n) return 0;
  return Number(formatEther(virtualEth)) / Number(formatUnits(virtualToken, 18));
}

/** Curve progress 0..100: share of curve supply already sold. */
export function curveProgress(realToken: bigint, curveSupply: bigint): number {
  if (curveSupply === 0n) return 0;
  return Number(((curveSupply - realToken) * 10_000n) / curveSupply) / 100;
}

export function timeAgo(seconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as { shortMessage?: string; message?: string };
    return err.shortMessage || err.message?.split("\n")[0] || "Transaction failed";
  }
  return String(e);
}
