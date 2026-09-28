import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { readJson } from "@/lib/body";
import { isValidHandle, normalizeHandle } from "@/lib/handles";
import { isLive } from "@/lib/networks";
import { clientIp, limitClient } from "@/lib/ratelimit";
import { requestNetwork, serverClient } from "@/lib/server-network";
import { deadlineFromNow, signAttestation, signerAccount } from "@/lib/signing";
import { MAX_RECIPIENTS } from "@/lib/split";
import { ResolverBusyError, resolveHandles } from "@/lib/x";

export const dynamic = "force-dynamic";

const TTL_SECONDS = 30 * 60;

/**
 * POST { network, creator, handles } → the X user ids for those usernames plus the signer's
 * attestation that FeeVault checks when the coin launches on that network. The ids come from our
 * resolver, never the client.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!limitClient("attest", ip, 20)) {
    return NextResponse.json({ error: "Too many requests, try again in a minute." }, { status: 429 });
  }
  if (!signerAccount()) return NextResponse.json({ error: "Launches are not configured on this server." }, { status: 500 });

  const body = await readJson<{ network?: string; creator?: string; handles?: string[] }>(req);
  const n = requestNetwork(body?.network);
  if (!n) return NextResponse.json({ error: "Unknown network." }, { status: 400 });
  if (!isLive(n)) return NextResponse.json({ error: `PonsEarn isn't live on ${n.label} yet.` }, { status: 400 });
  if (!body?.creator || !isAddress(body.creator)) return NextResponse.json({ error: "Connect a wallet first." }, { status: 400 });
  const handles = (Array.isArray(body.handles) ? body.handles : []).map((h) => normalizeHandle(String(h)));
  if (handles.length === 0 || handles.length > MAX_RECIPIENTS || !handles.every(isValidHandle)) {
    return NextResponse.json({ error: `Add 1 to ${MAX_RECIPIENTS} valid X usernames.` }, { status: 400 });
  }
  if (new Set(handles).size !== handles.length) return NextResponse.json({ error: "Each account can only appear once." }, { status: 400 });

  let profiles;
  try {
    profiles = await resolveHandles(handles, "attest", ip);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof ResolverBusyError ? 429 : 502 });
  }
  const missing = handles.filter((h) => !profiles[h]);
  if (missing.length) {
    return NextResponse.json({ error: `Could not find ${missing.map((h) => "@" + h).join(", ")} on X.` }, { status: 404 });
  }

  const xIds = handles.map((h) => BigInt(profiles[h]!.id));
  if (new Set(xIds.map(String)).size !== xIds.length) {
    return NextResponse.json({ error: "Two usernames point to the same X account." }, { status: 400 });
  }
  const deadline = await deadlineFromNow(serverClient(n), TTL_SECONDS);
  const attestation = await signAttestation(n, { creator: getAddress(body.creator), xIds, handles, deadline });

  return NextResponse.json({
    network: n.id,
    xIds: xIds.map(String),
    handles,
    deadline: deadline.toString(),
    attestation,
    profiles: handles.map((h) => profiles[h]),
  });
}
