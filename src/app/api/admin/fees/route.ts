import { ADMIN_NO_STORE, AdminAuthError, adminErrorResponse, adminRateLimit, requireAdmin } from "@/lib/admin-auth";
import { MAINNET_GENESIS_HASH } from "@/lib/admin-config";
import { isTikTokLaunchReady } from "@/lib/tiktok-config";
import { serverConnection, snapshot } from "@/lib/solana/server";
import { encode } from "@/lib/wire";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  try {
    adminRateLimit(req, "fees", 20);
    await requireAdmin(req);
    if (!isTikTokLaunchReady()) throw new AdminAuthError("fees_unavailable", "Configure the creator vault program before reading platform fees.", 503);
    if (await serverConnection().getGenesisHash() !== MAINNET_GENESIS_HASH) throw new AdminAuthError("wrong_network", "Platform fees must be read from Solana mainnet.", 503);
    const current = await snapshot();
    const coins = current.coins.map((coin) => {
      if (coin.pendingFees < 0n || !Number.isInteger(coin.platformBps) || coin.platformBps < 0 || coin.platformBps > 10_000) throw new Error("Invalid on-chain fee state");
      return { ...coin, pendingPlatformLamports: coin.pendingFees * BigInt(coin.platformBps) / 10_000n };
    });
    const pendingPlatformLamports = coins.reduce((sum, coin) => sum + coin.pendingPlatformLamports, 0n);
    return new Response(encode({ at: current.at, coins, pendingPlatformLamports }), { headers: { ...ADMIN_NO_STORE, "content-type": "application/json" } });
  } catch (error) {
    if (error instanceof AdminAuthError) return adminErrorResponse(error);
    return Response.json({ error: "Platform fees could not be read from Solana. Please try again.", code: "fees_read_failed" }, { status: 503, headers: ADMIN_NO_STORE });
  }
}
