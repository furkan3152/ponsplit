import { NextResponse } from "next/server";
import { getTikTokOAuthConfig, getVerificationMessage, publicTikTokSession, readTikTokSession, TikTokAuthError } from "@/lib/tiktok-auth";
import { guardTikTokRate, TIKTOK_NO_STORE, tiktokErrorResponse } from "@/lib/tiktok-auth-routes";
import { tikTokVerificationConfigured } from "@/lib/tiktok-auth-transaction";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    guardTikTokRate(req, "status", 60);
    const config = getTikTokOAuthConfig();
    const readiness = { oauth: !!config, verification: !!(config && tikTokVerificationConfigured()) };
    const session = config ? readTikTokSession(req, config) : null;
    if (!config || session?.kind !== "authenticated") return NextResponse.json({ readiness, session: null }, { headers: TIKTOK_NO_STORE });
    const wallet = new URL(req.url).searchParams.get("wallet");
    let verificationMessage: string | undefined;
    if (wallet) {
      try {
        if (wallet.length > 64) throw new Error("Invalid wallet");
        verificationMessage = getVerificationMessage(session, wallet, config.origin);
      } catch {
        throw new TikTokAuthError("invalid_wallet", "Please connect a valid Solana wallet.");
      }
    }
    return NextResponse.json({ readiness, session: publicTikTokSession(session), verificationMessage }, { headers: TIKTOK_NO_STORE });
  } catch (error) {
    return tiktokErrorResponse(error);
  }
}
