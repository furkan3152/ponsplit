import { keccak256, toBytes, type Hex } from "viem";

/** X usernames: 1-15 characters, letters, digits and underscores. */
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/** Accepts "@Name", "name", "x.com/name" or "https://twitter.com/name" and returns "name". */
export function normalizeHandle(input: string): string {
  let h = input.trim();
  h = h.replace(/^https?:\/\//i, "").replace(/^(www\.)?(x|twitter)\.com\//i, "");
  h = h.split(/[/?#]/)[0] ?? "";
  return h.replace(/^@/, "").toLowerCase();
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle);
}

/** Must match FeeVault: keccak256(bytes(lowercase handle without the at-sign)). */
export function handleHash(handle: string): Hex {
  return keccak256(toBytes(normalizeHandle(handle)));
}
