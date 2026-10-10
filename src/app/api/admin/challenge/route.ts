import { NextResponse } from "next/server";
import { ADMIN_CHALLENGE_COOKIE, ADMIN_CHALLENGE_SECONDS, ADMIN_NO_STORE, adminCookieOptions, adminErrorResponse, adminRateLimit, encryptAdminCookie, getAdminAuthConfig, getAdminChallengeMessage, newAdminChallenge, AdminAuthError } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    adminRateLimit(req, "challenge", 10);
    const config = getAdminAuthConfig();
    if (!config) throw new AdminAuthError("admin_auth_unavailable", "Admin authentication is not configured securely.", 503);
    const challenge = newAdminChallenge(new URL(req.url).searchParams.get("wallet") ?? "", config);
    const response = NextResponse.json({ message: getAdminChallengeMessage(challenge) }, { headers: ADMIN_NO_STORE });
    response.cookies.set(ADMIN_CHALLENGE_COOKIE, encryptAdminCookie(challenge, config.secret), adminCookieOptions(ADMIN_CHALLENGE_SECONDS));
    return response;
  } catch (error) { return adminErrorResponse(error); }
}
