import { keccak256, toBytes, type Hex } from "viem";

/**
 * SIGNER_PRIVATE_KEY as a 0x-prefixed 32-byte hex key. Accepts the common copy/paste variants
 * (no 0x prefix, as MetaMask exports it; surrounding whitespace). Returns null when it is set but
 * isn't a key. Must match normalizeKey() in next.config.mjs.
 */
export function normalizeKey(raw: string): Hex | null {
  const v = raw.trim();
  const k = /^0x/i.test(v) ? `0x${v.slice(2)}` : `0x${v}`;
  return /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : null;
}

/** Why the configured key can't be used, if it can't. */
export function adminKeyProblem(): string | undefined {
  const raw = process.env.SIGNER_PRIVATE_KEY;
  if (raw && raw.trim() && !normalizeKey(raw)) return "SIGNER_PRIVATE_KEY is set but isn't a 32-byte hex private key.";
  return undefined;
}

/**
 * The admin key, from SIGNER_PRIVATE_KEY or derived from SIGNER_SEED. The seed form lets a host
 * generate the secret itself (Render's `generateValue`), so nobody has to copy a key around.
 * Must match adminKeyFromEnv() in next.config.mjs.
 */
export function adminKey(): Hex | undefined {
  const raw = process.env.SIGNER_PRIVATE_KEY;
  if (raw && raw.trim()) return normalizeKey(raw) ?? undefined;
  const seed = process.env.SIGNER_SEED;
  if (seed) return keccak256(toBytes(`ponsplit-admin:${seed}`));
  return undefined;
}
