import { CDN_CACHE, snapshot } from "@/lib/solana/server";
import { encode } from "@/lib/wire";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Every Splidev coin and the GitHub accounts they pay, read once on the server. The CDN keeps each
 * answer a few seconds, so a crowd costs the Solana RPC one read, not one each.
 */
export async function GET() {
  try {
    return new Response(encode(await snapshot()), { headers: { "content-type": "application/json", "cache-control": CDN_CACHE } });
  } catch {
    return Response.json({ error: "Solana could not be read just now." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
