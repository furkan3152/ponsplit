import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getAddress, isAddress } from "viem";
import { feeVaultAbi } from "@/lib/abi";
import { authOptions } from "@/lib/auth";
import { readJson } from "@/lib/body";
import { isLive } from "@/lib/networks";
import { clientIp, limitClient } from "@/lib/ratelimit";
import { requestNetwork, serverClient } from "@/lib/server-network";
import { deadlineFromNow, signClaim, signerAccount } from "@/lib/signing";
import { ProofBusyError, verifyProofPost, type ProofResult } from "@/lib/xproof";

export const dynamic = "force-dynamic";

const SIGNATURE_TTL_SECONDS = 15 * 60;

/**
 * POST { network, to, proofUrl? } → a FeeVault claim signature for one X account on that network,
 * paying out to `to`. The account comes from either the X OAuth session or a verified proof post,
 * never from the body. The app sends it with the coins' latest fees collected in the same
 * transaction, so a zero balance right now isn't refused.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!limitClient("claim", ip, 20)) {
    return NextResponse.json({ error: "Too many attempts, try again in a minute." }, { status: 429 });
  }
  const body = await readJson<{ network?: string; to?: string; proofUrl?: string }>(req);
  const n = requestNetwork(body?.network);
  if (!n) return NextResponse.json({ error: "Unknown network." }, { status: 400 });
  if (!isLive(n)) return NextResponse.json({ error: `PonsEarn isn't live on ${n.label} yet.` }, { status: 400 });
  if (!body?.to || !isAddress(body.to)) {
    return NextResponse.json({ error: "A valid destination wallet is required." }, { status: 400 });
  }
  const to = getAddress(body.to);

  const account = signerAccount();
  if (!account) return NextResponse.json({ error: "Claims are not configured on this server." }, { status: 500 });

  let x: ProofResult | undefined;
  if (body.proofUrl) {
    try {
      x = await verifyProofPost(String(body.proofUrl), to, ip);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: e instanceof ProofBusyError ? 429 : 400 });
    }
  } else {
    x = (await getServerSession(authOptions))?.x;
  }
  if (!x) return NextResponse.json({ error: "Verify your X account first." }, { status: 401 });

  const client = serverClient(n);
  const xId = BigInt(x.id);
  let signer: string, nonce: bigint, claimable: bigint;
  try {
    [signer, nonce, claimable] = await Promise.all([
      client.readContract({ address: n.feeVault!, abi: feeVaultAbi, functionName: "signer" }),
      client.readContract({ address: n.feeVault!, abi: feeVaultAbi, functionName: "nonces", args: [xId] }),
      client.readContract({ address: n.feeVault!, abi: feeVaultAbi, functionName: "claimable", args: [xId] }),
    ]);
  } catch {
    return NextResponse.json({ error: "Couldn't reach the chain right now. Try again in a moment." }, { status: 502 });
  }
  if (signer.toLowerCase() !== account.address.toLowerCase()) {
    return NextResponse.json({ error: "This site's signing key isn't the one FeeVault trusts." }, { status: 500 });
  }

  const deadline = await deadlineFromNow(client, SIGNATURE_TTL_SECONDS);
  const signature = await signClaim(n, { xId, to, nonce, deadline });

  return NextResponse.json({
    network: n.id,
    xId: xId.toString(),
    username: x.username,
    to,
    deadline: deadline.toString(),
    claimable: claimable.toString(),
    signature,
  });
}
