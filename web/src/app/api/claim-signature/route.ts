import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { createPublicClient, getAddress, http, isAddress } from "viem";
import { feeVaultAbi } from "@/lib/abi";
import { authOptions } from "@/lib/auth";
import { activeChain, rpcUrl } from "@/lib/chains";
import { FEE_VAULT_ADDRESS } from "@/lib/config";
import { deadlineFromNow, signClaim, signerAccount } from "@/lib/signing";

export const dynamic = "force-dynamic";

const SIGNATURE_TTL_SECONDS = 15 * 60;

/**
 * Signs a FeeVault claim for the X account in the caller's session, paying out to `to`.
 * The account id always comes from the verified OAuth session, never from the request body.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const x = session?.x;
  if (!x) return NextResponse.json({ error: "Sign in with X first." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { to?: string } | null;
  if (!body?.to || !isAddress(body.to)) {
    return NextResponse.json({ error: "A valid destination wallet is required." }, { status: 400 });
  }

  const account = signerAccount();
  if (!account || !FEE_VAULT_ADDRESS) {
    return NextResponse.json({ error: "Claims are not configured on this server." }, { status: 500 });
  }

  const client = createPublicClient({ chain: activeChain, transport: http(rpcUrl) });
  const xId = BigInt(x.id);
  const [signer, nonce, claimable] = await Promise.all([
    client.readContract({ address: FEE_VAULT_ADDRESS, abi: feeVaultAbi, functionName: "signer" }),
    client.readContract({ address: FEE_VAULT_ADDRESS, abi: feeVaultAbi, functionName: "nonces", args: [xId] }),
    client.readContract({ address: FEE_VAULT_ADDRESS, abi: feeVaultAbi, functionName: "claimable", args: [xId] }),
  ]);

  if (signer.toLowerCase() !== account.address.toLowerCase()) {
    return NextResponse.json({ error: "Server signer does not match FeeVault.signer." }, { status: 500 });
  }
  if (claimable === 0n) {
    return NextResponse.json({ error: `Nothing to claim for @${x.username} yet.` }, { status: 400 });
  }

  const to = getAddress(body.to);
  const deadline = await deadlineFromNow(client, SIGNATURE_TTL_SECONDS);
  const signature = await signClaim({ xId, to, nonce, deadline });

  return NextResponse.json({ xId: xId.toString(), to, deadline: deadline.toString(), claimable: claimable.toString(), signature });
}
