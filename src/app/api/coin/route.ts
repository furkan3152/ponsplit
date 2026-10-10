import { CDN_CACHE, coinView } from "@/lib/solana/server";
import { encode } from "@/lib/wire";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** GET ?mint= → { coin } (null when the mint isn't a Tiksplit coin). */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return Response.json({ error: "Not a Solana address." }, { status: 400 });
  try {
    const coin = await coinView(mint);
    return new Response(encode({ coin }), { headers: { "content-type": "application/json", "cache-control": CDN_CACHE } });
  } catch {
    return Response.json({ error: "Solana could not be read just now." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
