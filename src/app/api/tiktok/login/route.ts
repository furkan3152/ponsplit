import { NextResponse } from "next/server";
import { buildTikTokAuthorizationUrl, encryptTikTokSession, newOAuthSession, OAUTH_LIFETIME_SECONDS, requireTikTokOAuthConfig, sessionCookieOptions, TIKTOK_COOKIE } from "@/lib/tiktok-auth";
import { guardTikTokRate, TIKTOK_NO_STORE, tiktokErrorResponse } from "@/lib/tiktok-auth-routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    guardTikTokRate(req, "login", 10);
    const config = requireTikTokOAuthConfig();
    const pending = newOAuthSession();
    const response = NextResponse.redirect(buildTikTokAuthorizationUrl(config, pending), 303);
    response.headers.set("cache-control", TIKTOK_NO_STORE["cache-control"]);
    response.cookies.set(TIKTOK_COOKIE, encryptTikTokSession(pending, config.sessionSecret), sessionCookieOptions(OAUTH_LIFETIME_SECONDS));
    return response;
  } catch (error) {
    return tiktokErrorResponse(error);
  }
}
