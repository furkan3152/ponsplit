import type { Address, Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

export const CLAIM_DOMAIN_NAME = "PonSplit FeeVault";
export const CLAIM_DOMAIN_VERSION = "1";

export const claimTypes = {
  Claim: [
    { name: "handleHash", type: "bytes32" },
    { name: "to", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** EIP-712 signature accepted by FeeVault.claim. Must stay in sync with FeeVault.CLAIM_TYPEHASH. */
export function signClaim(
  account: PrivateKeyAccount,
  args: { chainId: number; vault: Address; handleHash: Hex; to: Address; nonce: bigint; deadline: bigint }
) {
  return account.signTypedData({
    domain: { name: CLAIM_DOMAIN_NAME, version: CLAIM_DOMAIN_VERSION, chainId: args.chainId, verifyingContract: args.vault },
    types: claimTypes,
    primaryType: "Claim",
    message: { handleHash: args.handleHash, to: args.to, nonce: args.nonce, deadline: args.deadline },
  });
}
