import { NextResponse } from "next/server";
import { assertSameOrigin, requireTikTokOAuthConfig, sessionCookieOptions, TIKTOK_COOKIE } from "@/lib/tiktok-auth";
import { guardTikTokRate, TIKTOK_NO_STORE, tiktokErrorResponse } from "@/lib/tiktok-auth-routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    guardTikTokRate(req, "logout", 20);
    assertSameOrigin(req, requireTikTokOAuthConfig());
    const response = NextResponse.json({ ok: true }, { headers: TIKTOK_NO_STORE });
    response.cookies.set(TIKTOK_COOKIE, "", sessionCookieOptions(0));
    return response;
  } catch (error) {
    return tiktokErrorResponse(error);
  }
}
