import { isAddress, getAddress } from "viem";
import { NETWORKS, isHidden, isLive, parseNetwork } from "@/lib/networks";
import { missingTimes } from "@/lib/chain-reads";
import { clientIp, limitClient } from "@/lib/ratelimit";
import { CDN_CACHE, coinTradesFor } from "@/lib/server-snapshot";
import { encode } from "@/lib/wire";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A coin's latest ~2 days of trades, read once on the server and cached by the CDN for a few seconds. */
export async function GET(req: Request) {
  // Only CDN misses get here (a few per coin per minute); a client asking for many coins is not a page.
  if (!limitClient("trades", clientIp(req), 120)) {
    return Response.json({ error: "Too many requests." }, { status: 429, headers: { "cache-control": "no-store", "retry-after": "30" } });
  }
  const params = new URL(req.url).searchParams;
  const id = parseNetwork(params.get("network"));
  const n = id ? NETWORKS[id] : undefined;
  const token = params.get("token") ?? "";
  if (!n || !isLive(n) || !isAddress(token, { strict: false }) || isHidden(n, token)) {
    return Response.json({ error: "Unknown coin." }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  try {
    const trades = await coinTradesFor(n, getAddress(token));
    if (!trades) return Response.json({ error: "Unknown coin." }, { status: 404, headers: { "cache-control": "no-store" } });
    const cache = missingTimes(trades.trades) ? "no-store" : CDN_CACHE;
    return new Response(encode(trades), { headers: { "content-type": "application/json", "cache-control": cache } });
  } catch {
    return Response.json({ error: "The chain could not be read just now." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
