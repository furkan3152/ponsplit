import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { createPublicClient, getAddress, http, isAddress } from "viem";
import { feeVaultAbi } from "@/lib/abi";
import { authOptions } from "@/lib/auth";
import { activeChain, rpcUrl } from "@/lib/chains";
import { FEE_VAULT_ADDRESS } from "@/lib/config";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { deadlineFromNow, signClaim, signerAccount } from "@/lib/signing";
import { verifyProofPost, type ProofResult } from "@/lib/xproof";

export const dynamic = "force-dynamic";

const SIGNATURE_TTL_SECONDS = 15 * 60;

/**
 * POST { to, proofUrl? } → a FeeVault claim signature for one X account, paying out to `to`.
 * The account comes from either the X OAuth session or a verified proof post, never from the body.
 */
export async function POST(req: Request) {
  if (!rateLimit(`claim:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many attempts, try again in a minute." }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { to?: string; proofUrl?: string } | null;
  if (!body?.to || !isAddress(body.to)) {
    return NextResponse.json({ error: "A valid destination wallet is required." }, { status: 400 });
  }
  const to = getAddress(body.to);

  const account = signerAccount();
  if (!account || !FEE_VAULT_ADDRESS) {
    return NextResponse.json({ error: "Claims are not configured on this server." }, { status: 500 });
  }

  let x: ProofResult | undefined;
  if (body.proofUrl) {
    try {
      x = await verifyProofPost(body.proofUrl, to);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  } else {
    x = (await getServerSession(authOptions))?.x;
  }
  if (!x) return NextResponse.json({ error: "Verify your X account first." }, { status: 401 });

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

  const deadline = await deadlineFromNow(client, SIGNATURE_TTL_SECONDS);
  const signature = await signClaim({ xId, to, nonce, deadline });

  return NextResponse.json({
    xId: xId.toString(),
    username: x.username,
    to,
    deadline: deadline.toString(),
    claimable: claimable.toString(),
    signature,
  });
}
