import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { readJson } from "@/lib/body";
import { assertSameOrigin, fetchTikTokProfile, getVerificationMessage, readTikTokSession, requireTikTokOAuthConfig, TikTokAuthError, verifyWalletMessage } from "@/lib/tiktok-auth";
import { guardTikTokRate, TIKTOK_NO_STORE, tiktokErrorResponse } from "@/lib/tiktok-auth-routes";
import { buildAttestedCreatorBind, tikTokVerificationConfigured } from "@/lib/tiktok-auth-transaction";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    guardTikTokRate(req, "verify", 10);
    const config = requireTikTokOAuthConfig();
    assertSameOrigin(req, config);
    if (!tikTokVerificationConfigured()) throw new TikTokAuthError("verification_unavailable", "Creator verification is not configured. Please try again after setup.", 503);
    const session = readTikTokSession(req, config);
    if (session?.kind !== "authenticated") throw new TikTokAuthError("login_required", "Connect your TikTok account before verifying your wallet.", 401);
    const body = await readJson<{ wallet?: unknown; signature?: unknown }>(req, 2048);
    if (!body || typeof body.wallet !== "string" || body.wallet.length > 64 || typeof body.signature !== "string" || body.signature.length > 128) throw new TikTokAuthError("invalid_request", "A wallet and its signed verification message are required.");
    let wallet: PublicKey;
    try { wallet = new PublicKey(body.wallet); } catch { throw new TikTokAuthError("invalid_wallet", "Please connect a valid Solana wallet."); }
    const message = getVerificationMessage(session, wallet.toBase58(), config.origin);
    if (!verifyWalletMessage(message, wallet, body.signature)) throw new TikTokAuthError("invalid_signature", "The wallet signature could not be verified. Please sign the current challenge again.", 403);
    // Recheck the official profile immediately before signing: a renamed account must reconnect.
    const current = await fetchTikTokProfile(session.accessToken);
    if (current.openId !== session.openId || current.handle !== session.handle) throw new TikTokAuthError("profile_changed", "Your TikTok username changed. Reconnect TikTok before verifying.", 409);
    const result = await buildAttestedCreatorBind(session, wallet, { message, signature: body.signature });
    return NextResponse.json(result, { headers: TIKTOK_NO_STORE });
  } catch (error) {
    return tiktokErrorResponse(error);
  }
}
