import { CDN_CACHE, coinTrades, coinView } from "@/lib/solana/server";
import { encode } from "@/lib/wire";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET ?mint= → { trades } (newest first), shared by every visitor of the coin's page. */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return Response.json({ error: "Not a Solana address." }, { status: 400 });
  try {
    // Only Splidev coins: the route must not become a free RPC proxy for any address.
    const coin = await coinView(mint);
    if (!coin) return Response.json({ error: "Not a Splidev coin." }, { status: 404 });
    const trades = await coinTrades(mint, coin.graduated);
    return new Response(encode({ trades }), { headers: { "content-type": "application/json", "cache-control": CDN_CACHE } });
  } catch {
    return Response.json({ error: "Solana could not be read just now." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
