import { NETWORKS, isLive, parseNetwork } from "@/lib/networks";
import { CDN_CACHE, snapshotFor } from "@/lib/server-snapshot";
import { encode } from "@/lib/wire";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * What every visitor of a network sees (coins, activity, payouts), read once on the server. The
 * CDN keeps each answer for a few seconds, so a crowd costs the chain's RPC one read, not one each.
 */
export async function GET(req: Request) {
  const id = parseNetwork(new URL(req.url).searchParams.get("network"));
  const n = id ? NETWORKS[id] : undefined;
  if (!n || !isLive(n)) return Response.json({ error: "Unknown or not deployed network." }, { status: 404 });
  try {
    return new Response(encode(await snapshotFor(n)), { headers: { "content-type": "application/json", "cache-control": CDN_CACHE } });
  } catch {
    return Response.json({ error: "The chain could not be read just now." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
