import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { createPublicClient, http, isAddress, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { authOptions } from "@/lib/auth";
import { feeVaultAbi } from "@/lib/abi";
import { activeChain, rpcUrl } from "@/lib/chains";
import { signClaim } from "@/lib/claim";
import { FEE_VAULT_ADDRESS } from "@/lib/config";
import { handleHash } from "@/lib/handles";

export const dynamic = "force-dynamic";

const SIGNATURE_TTL_SECONDS = 15 * 60;

/**
 * Signs a FeeVault claim for the X account in the caller's session, paying out to `to`.
 * The handle always comes from the verified OAuth session, never from the request body.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const username = session?.xUsername;
  if (!username) return NextResponse.json({ error: "Sign in with X first." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { to?: string } | null;
  if (!body?.to || !isAddress(body.to)) {
    return NextResponse.json({ error: "A valid destination wallet is required." }, { status: 400 });
  }

  const key = process.env.SIGNER_PRIVATE_KEY as Hex | undefined;
  if (!key || !FEE_VAULT_ADDRESS) {
    return NextResponse.json({ error: "Claims are not configured on this server." }, { status: 500 });
  }

  const account = privateKeyToAccount(key);
  const client = createPublicClient({ chain: activeChain, transport: http(rpcUrl) });
  const hash = handleHash(username);

  const [signer, nonce, claimable] = await Promise.all([
    client.readContract({ address: FEE_VAULT_ADDRESS, abi: feeVaultAbi, functionName: "signer" }),
    client.readContract({ address: FEE_VAULT_ADDRESS, abi: feeVaultAbi, functionName: "nonces", args: [hash] }),
    client.readContract({ address: FEE_VAULT_ADDRESS, abi: feeVaultAbi, functionName: "claimable", args: [hash] }),
  ]);

  if (signer.toLowerCase() !== account.address.toLowerCase()) {
    return NextResponse.json({ error: "Server signer does not match FeeVault.signer." }, { status: 500 });
  }
  if (claimable === 0n) {
    return NextResponse.json({ error: `Nothing to claim for @${username} yet.` }, { status: 400 });
  }

  const to = getAddress(body.to);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + SIGNATURE_TTL_SECONDS);
  const signature = await signClaim(account, {
    chainId: activeChain.id,
    vault: FEE_VAULT_ADDRESS,
    handleHash: hash,
    to,
    nonce,
    deadline,
  });

  return NextResponse.json({
    handle: username,
    handleHash: hash,
    to,
    deadline: deadline.toString(),
    claimable: claimable.toString(),
    signature,
  });
}
