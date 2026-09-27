import { keccak256, toBytes, type Hex } from "viem";

/**
 * The admin key, from SIGNER_PRIVATE_KEY or derived from SIGNER_SEED. The seed form lets a host
 * generate the secret itself (Render's `generateValue`), so nobody has to copy a key around.
 * Must match adminKeyFromEnv() in next.config.mjs.
 */
export function adminKey(): Hex | undefined {
  const key = process.env.SIGNER_PRIVATE_KEY;
  if (key) return key as Hex;
  const seed = process.env.SIGNER_SEED;
  if (seed) return keccak256(toBytes(`ponsplit-admin:${seed}`));
  return undefined;
}
