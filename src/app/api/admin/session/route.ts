import { NextResponse } from "next/server";
import { readJson } from "@/lib/body";
import { ADMIN_CHALLENGE_COOKIE, ADMIN_NO_STORE, ADMIN_SESSION_COOKIE, ADMIN_SESSION_SECONDS, adminAuthReady, adminCookieOptions, adminErrorResponse, adminRateLimit, authenticateAdmin, encryptAdminCookie, getAdminAuthConfig, getAdminSession, AdminAuthError } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    adminRateLimit(req, "status", 60);
    const readiness = adminAuthReady();
    const session = readiness ? await getAdminSession(req) : null;
    return NextResponse.json({ readiness, authenticated: !!session, wallet: session?.wallet ?? null }, { headers: ADMIN_NO_STORE });
  } catch (error) { return adminErrorResponse(error); }
}

export async function POST(req: Request) {
  try {
    adminRateLimit(req, "session", 10);
    const body = await readJson<{ wallet?: unknown; signature?: unknown }>(req, 2048);
    if (!body || typeof body.wallet !== "string" || body.wallet.length > 64 || typeof body.signature !== "string" || body.signature.length > 128) throw new AdminAuthError("invalid_request", "An admin wallet and its signed challenge are required.");
    const session = await authenticateAdmin(req, body.wallet, body.signature);
    const config = getAdminAuthConfig();
    if (!config) throw new AdminAuthError("admin_auth_unavailable", "Admin authentication is not configured securely.", 503);
    const response = NextResponse.json({ readiness: true, authenticated: true, wallet: session.wallet }, { headers: ADMIN_NO_STORE });
    response.cookies.set(ADMIN_CHALLENGE_COOKIE, "", adminCookieOptions(0));
    response.cookies.set(ADMIN_SESSION_COOKIE, encryptAdminCookie(session, config.secret), adminCookieOptions(ADMIN_SESSION_SECONDS));
    return response;
  } catch (error) { return adminErrorResponse(error); }
}
