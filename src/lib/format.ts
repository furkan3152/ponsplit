
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

/** Lamports as SOL: 0.0123, <0.0001. */
export function formatSol(lamports: bigint | number, digits = 4): string {
  const n = Number(lamports) / 1e9;
  if (n === 0) return "0";
  if (n < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}`;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function compact(n: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: digits }).format(n);
}

/** pump.fun coins have 6 decimals. */
export const formatTokens = (raw: bigint, digits = 2) => compact(Number(raw) / 1e6, digits);

export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export const pct = (bps: number | bigint) => `${(Number(bps) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/**
 * A curve progress for display, rounded down: a coin that hasn't graduated never reads 100%.
 * (The epsilon absorbs float noise such as 0.29 * 100 = 28.999999999999996.)
 */
export function progressText(progress: number, digits = 0): string {
  const f = 10 ** digits;
  return (Math.floor(progress * f + 1e-6) / f).toFixed(digits);
}

export function timeAgo(seconds: number | bigint): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - Number(seconds));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

/** A person-readable message for a failed wallet or chain call. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as { message?: string; name?: string; logs?: string[] };
    const msg = err.message?.split("\n")[0] || "Something went wrong";
    if (/^401:/.test(msg) && /UNAUTHORIZED/i.test(msg) && /"instance"/.test(msg)) return "The Solana RPC provider rejected this website. The site administrator must add the current domain to the RPC referrer allowlist, then refresh. This error is not a wallet rejection.";
    if (/user rejected|rejected the request|denied|WalletSignTransactionError/i.test(`${err.name} ${msg}`)) return "Cancelled in wallet.";
    const logs = (err.logs ?? []).join("\n") + msg;
    if (/insufficient (funds|lamports)|0x1\b|InsufficientFundsForRent/i.test(logs)) return "Not enough SOL in this wallet for the amount plus network fees.";
    if (/TooMuchSolRequired|TooLittleSolReceived|ExceededSlippage|0x1772|0x1773|slippage/i.test(logs)) return "The price moved too much. Try again.";
    if (/BondingCurveComplete|0x1775/i.test(logs)) return "This coin just left the curve. Reload the page to trade it on the pool.";
    if (/blockhash not found|block height exceeded/i.test(logs)) return "The network was slow to confirm. Try again.";
    // A failed simulation's first line says only "Simulation failed."; the program's own error is
    // more useful (Anchor's "Error Message: …", else the RPC's "Message: …" line).
    const anchor = logs.match(/Error Message: ([^\n.]+)/)?.[1];
    if (anchor) return `${anchor}.`;
    const detail = err.message?.match(/Message: ([^\n]+)/)?.[1];
    if (/simulation failed/i.test(msg) && detail) return detail.replace(/^Transaction simulation failed: /, "Simulation failed: ");
    return msg;
  }
  return String(e);
}
