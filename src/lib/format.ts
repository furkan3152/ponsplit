import { formatEther, formatUnits } from "viem";

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/** Tiny prices the dexscreener way: 0.00000000205 → "0.0₈205". */
export function formatPrice(n: number, sig = 3): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (n >= 0.001) return n.toPrecision(sig);
  // The subscript counts every zero after the decimal point: 2.05e-9 has 8 of them.
  let zeros = -Math.floor(Math.log10(n)) - 1;
  let digits = Math.round(n * 10 ** (zeros + sig));
  if (digits >= 10 ** sig) {
    // Rounding carried into a new digit (e.g. 9.9996e-4 → 1000): one zero fewer.
    zeros -= 1;
    digits = Math.round(digits / 10);
  }
  const sub = zeros
    .toString()
    .split("")
    .map((d) => SUBSCRIPT[Number(d)])
    .join("");
  return `0.0${sub}${digits}`;
}

export function formatEth(wei: bigint, digits = 4): string {
  const n = Number(formatEther(wei));
  if (n === 0) return "0";
  if (n < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}`;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function compact(n: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: digits }).format(n);
}

export const formatTokens = (amount: bigint, digits = 2) => compact(Number(formatUnits(amount, 18)), digits);

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const pct = (bps: number | bigint) => `${(Number(bps) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** Spot price in ETH per whole token. */
export function spotPrice(virtualEth: bigint, virtualToken: bigint): number {
  if (virtualToken === 0n) return 0;
  return Number(formatEther(virtualEth)) / Number(formatUnits(virtualToken, 18));
}

/** Trade record price (wei per 1e18 units) → ETH per token. */
export const recordPrice = (price: bigint) => Number(price) / 1e18;

/** Curve progress 0..100: share of curve supply already sold. */
export function curveProgress(realToken: bigint, curveSupply: bigint, graduated: boolean): number {
  if (graduated) return 100;
  if (curveSupply === 0n) return 0;
  return Number(((curveSupply - realToken) * 10_000n) / curveSupply) / 100;
}

export function timeAgo(seconds: number | bigint): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - Number(seconds));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as { shortMessage?: string; message?: string };
    const msg = err.shortMessage || err.message?.split("\n")[0] || "Something went wrong";
    if (/user rejected|denied/i.test(msg)) return "Cancelled in wallet.";
    return msg;
  }
  return String(e);
}
