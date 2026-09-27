import "server-only";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeChain } from "./chains";
import { adminKey } from "./adminKey";
import { FEE_VAULT_ADDRESS } from "./config";

// Must stay in sync with FeeVault's EIP712("PonSplit FeeVault", "2") and its typehashes.
const domain = () => ({
  name: "PonSplit FeeVault",
  version: "2",
  chainId: activeChain.id,
  verifyingContract: FEE_VAULT_ADDRESS as Address,
});

export function signerAccount() {
  const key = adminKey();
  if (!key || !FEE_VAULT_ADDRESS) return undefined;
  return privateKeyToAccount(key);
}

export function signAttestation(args: { creator: Address; xIds: bigint[]; handles: string[]; deadline: bigint }) {
  const account = signerAccount();
  if (!account) throw new Error("Signer not configured");
  return account.signTypedData({
    domain: domain(),
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

export function signClaim(args: { xId: bigint; to: Address; nonce: bigint; deadline: bigint }) {
  const account = signerAccount();
  if (!account) throw new Error("Signer not configured");
  return account.signTypedData({
    domain: domain(),
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
