import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { MAX_RECIPIENTS } from "@/lib/config";
import { isValidHandle, normalizeHandle } from "@/lib/handles";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { createPublicClient, http } from "viem";
import { activeChain, rpcUrl } from "@/lib/chains";
import { deadlineFromNow, signAttestation, signerAccount } from "@/lib/signing";
import { resolveHandles } from "@/lib/x";
import { readJson } from "@/lib/body";

export const dynamic = "force-dynamic";

const TTL_SECONDS = 30 * 60;

/**
 * POST { creator, handles } → the X user ids for those usernames plus the signer's attestation
 * that FeeVault checks when the token is created. The ids come from our resolver, never the client.
 */
export async function POST(req: Request) {
  if (!rateLimit(`attest:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests, try again in a minute." }, { status: 429 });
  }
  if (!signerAccount()) return NextResponse.json({ error: "Launches are not configured on this server." }, { status: 500 });

  const body = await readJson<{ creator?: string; handles?: string[] }>(req);
  if (!body?.creator || !isAddress(body.creator)) return NextResponse.json({ error: "Connect a wallet first." }, { status: 400 });
  const handles = (body.handles ?? []).map(normalizeHandle);
  if (handles.length === 0 || handles.length > MAX_RECIPIENTS || !handles.every(isValidHandle)) {
    return NextResponse.json({ error: "Add 1 to 10 valid X usernames." }, { status: 400 });
  }
  if (new Set(handles).size !== handles.length) return NextResponse.json({ error: "Each account can only appear once." }, { status: 400 });

  let profiles;
  try {
    profiles = await resolveHandles(handles);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  const missing = handles.filter((h) => !profiles[h]);
  if (missing.length) {
    return NextResponse.json({ error: `Could not find ${missing.map((h) => "@" + h).join(", ")} on X.` }, { status: 404 });
  }

  const xIds = handles.map((h) => BigInt(profiles[h]!.id));
  if (new Set(xIds.map(String)).size !== xIds.length) {
    return NextResponse.json({ error: "Two usernames point to the same X account." }, { status: 400 });
  }
  const client = createPublicClient({ chain: activeChain, transport: http(rpcUrl, { fetchOptions: { cache: "no-store" } }) });
  const deadline = await deadlineFromNow(client, TTL_SECONDS);
  const attestation = await signAttestation({ creator: getAddress(body.creator), xIds, handles, deadline });

  return NextResponse.json({
    xIds: xIds.map(String),
    handles,
    deadline: deadline.toString(),
    attestation,
    profiles: handles.map((h) => profiles[h]),
  });
}
