import "server-only";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { adminKey } from "./adminKey";
import type { Network } from "./networks";

/**
 * The server's signing key. It only signs: launch attestations (X username → account id) and claim
 * payouts, for both networks. It holds no funds and owns nothing; the owner's wallet owns the
 * contracts, and FeeVault.setSigner replaces the key.
 */
export function signerAccount() {
  const key = adminKey();
  return key ? privateKeyToAccount(key) : undefined;
}

// Must stay in sync with FeeVault's EIP712("SplitEarn FeeVault", "1") and its typehashes. The chain id
// and the vault's address keep a signature for one network (or one vault) from working on another.
function domain(n: Network) {
  if (!n.feeVault) throw new Error(`SplitEarn isn't live on ${n.label} yet.`);
  return { name: "SplitEarn FeeVault", version: "1", chainId: n.chain.id, verifyingContract: n.feeVault } as const;
}

export function signAttestation(n: Network, args: { creator: Address; xIds: bigint[]; handles: string[]; deadline: bigint }) {
  const account = signerAccount();
  if (!account) throw new Error("Signer not configured");
  return account.signTypedData({
    domain: domain(n),
    types: {
      SplitAttestation: [
        { name: "creator", type: "address" },
        { name: "xIds", type: "uint64[]" },
        { name: "handles", type: "string[]" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "SplitAttestation",
    message: args,
  });
}

export function signClaim(n: Network, args: { xId: bigint; to: Address; nonce: bigint; deadline: bigint }) {
  const account = signerAccount();
  if (!account) throw new Error("Signer not configured");
  return account.signTypedData({
    domain: domain(n),
    types: {
      Claim: [
        { name: "xId", type: "uint64" },
        { name: "to", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Claim",
    message: args,
  });
}

/** Deadline based on whichever is later, server clock or chain clock, so clock skew never pre-expires a signature. */
export async function deadlineFromNow(client: { getBlock: () => Promise<{ timestamp: bigint }> }, ttlSeconds: number) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const chainNow = await client
    .getBlock()
    .then((b) => b.timestamp)
    .catch(() => now);
  return (chainNow > now ? chainNow : now) + BigInt(ttlSeconds);
}
