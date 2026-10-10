import { NextResponse } from "next/server";
import { encryptTikTokSession, equalOAuthState, exchangeTikTokCode, readTikTokSession, requireTikTokOAuthConfig, sessionCookieOptions, TIKTOK_COOKIE, TikTokAuthError } from "@/lib/tiktok-auth";
import { guardTikTokRate, TIKTOK_NO_STORE } from "@/lib/tiktok-auth-routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    guardTikTokRate(req, "callback", 10);
    const config = requireTikTokOAuthConfig();
    const pending = readTikTokSession(req, config);
    const params = new URL(req.url).searchParams;
    if (pending?.kind !== "oauth" || !equalOAuthState(params.get("state"), pending.state)) throw new TikTokAuthError("invalid_state", "The login request expired. Please reconnect.", 403);
    if (params.has("error")) throw new TikTokAuthError("access_denied", "TikTok access was not granted.", 403);
    const session = await exchangeTikTokCode(config, pending, params.get("code") ?? "");
    const response = claimRedirect("/claim?tiktok=connected");
    response.cookies.set(TIKTOK_COOKIE, encryptTikTokSession(session, config.sessionSecret), sessionCookieOptions(Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000))));
    return response;
  } catch (error) {
    const code = error instanceof TikTokAuthError ? error.code : "tiktok_unavailable";
    const response = claimRedirect(`/claim?tiktok_error=${encodeURIComponent(code)}`);
    response.cookies.set(TIKTOK_COOKIE, "", sessionCookieOptions(0));
    return response;
  }
}

function claimRedirect(location: string): NextResponse {
  // Relative fixed destinations avoid trusting forwarded Host/protocol headers.
  return new NextResponse(null, { status: 303, headers: { ...TIKTOK_NO_STORE, location } });
}
