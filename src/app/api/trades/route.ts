import { isAddress, getAddress } from "viem";
import { NETWORKS, isHidden, isLive, parseNetwork } from "@/lib/networks";
import { CDN_CACHE, coinTradesFor } from "@/lib/server-snapshot";
import { encode } from "@/lib/wire";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A coin's latest ~2 days of trades, read once on the server and cached by the CDN for a few seconds. */
export async function GET(req: Request) {
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
    return new Response(encode(trades), { headers: { "content-type": "application/json", "cache-control": CDN_CACHE } });
  } catch {
    return Response.json({ error: "The chain could not be read just now." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
