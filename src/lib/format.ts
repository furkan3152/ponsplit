import { formatEther, formatUnits, keccak256, toBytes } from "viem";
import * as abis from "./abi";

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/** Tiny prices the dexscreener way: 0.00000000205 → "0.0₈205". */
export function formatPrice(n: number, sig = 3): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n < 0) return `-${formatPrice(-n, sig)}`; // chart axes can put a tick just below zero
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

/**
 * A curve progress for display, rounded down: a coin that hasn't graduated never reads 100%.
 * (The epsilon absorbs float noise such as 0.29 * 100 = 28.999999999999996.)
 */
export function progressText(progress: number, digits = 0): string {
  const f = 10 ** digits;
  return (Math.floor(progress * f + 1e-6) / f).toFixed(digits);
}

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

/** What the contracts' errors mean for a person (SplitEarn's, the FeeVault's and pons's). */
const REVERTS: Record<string, string> = {
  NothingToClaim: "There is nothing to claim yet.",
  Expired: "The signature expired. Try again.",
  BadSignature: "The claim signature isn't valid for this wallet. Try again.",
  ClaimsPaused: "Claims are paused for now.",
  InvalidSplit: "The split isn't valid (check the accounts and their shares).",
  MetadataTooLong: "A name, ticker, image or link is too long for pons.",
  LaunchEconomicsMismatch: "pons changed its launch terms. Reload the page and try again.",
  TermsChanged: "The launch terms changed. Reload the page and try again.",
  CreatorTaxTooHigh: "The creator tax is higher than pons allows.",
  LaunchesPaused: "Launches are paused for now.",
  SlippageExceeded: "The price moved too much. Try again.",
  InsufficientOutput: "The price moved too much. Try again.",
  InternalSwapRequiresOperator: "pons is still releasing this coin's pool fees. Try again later.",
};

type AbiError = { type: string; name?: string; inputs?: readonly { type: string; components?: readonly unknown[] }[] };
let selectors: Map<string, string> | undefined;

/** 4-byte selector → error name, for every custom error in SplitEarn's and pons's contracts. */
function errorSelectors(): Map<string, string> {
  if (selectors) return selectors;
  selectors = new Map();
  const canonical = (i: { type: string; components?: readonly unknown[] }): string =>
    i.type.startsWith("tuple")
      ? `(${(i.components as { type: string; components?: readonly unknown[] }[]).map(canonical).join(",")})${i.type.slice(5)}`
      : i.type;
  for (const abi of Object.values(abis) as readonly (readonly AbiError[])[]) {
    for (const item of abi) {
      if (item.type !== "error" || !item.name) continue;
      const sig = `${item.name}(${(item.inputs ?? []).map(canonical).join(",")})`;
      selectors.set(keccak256(toBytes(sig)).slice(0, 10), item.name);
    }
  }
  return selectors;
}

/** The name of the custom error a contract reverted with: decoded by viem, or looked up by selector. */
function revertName(e: unknown): string | undefined {
  for (let err = e as { data?: { errorName?: string }; cause?: unknown } | undefined, i = 0; err && i < 6; err = err.cause as typeof err, i++) {
    if (err.data?.errorName) return err.data.errorName;
  }
  const text = String((e as { message?: string })?.message ?? "");
  const sel = /signature:?\s*(0x[0-9a-fA-F]{8})/.exec(text)?.[1]?.toLowerCase();
  if (sel) return errorSelectors().get(sel);
  return Object.keys(REVERTS).find((k) => text.includes(k));
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as { shortMessage?: string; message?: string };
    const msg = err.shortMessage || err.message?.split("\n")[0] || "Something went wrong";
    if (/user rejected|denied/i.test(msg)) return "Cancelled in wallet.";
    const name = revertName(e);
    if (name && REVERTS[name]) return REVERTS[name];
    if (/insufficient funds/i.test(err.message ?? "")) return "Not enough ETH in this wallet for the amount plus gas.";
    return msg;
  }
  return String(e);
}
