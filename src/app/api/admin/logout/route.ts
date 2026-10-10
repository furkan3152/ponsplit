import { NextResponse } from "next/server";
import { ADMIN_CHALLENGE_COOKIE, ADMIN_NO_STORE, ADMIN_SESSION_COOKIE, adminCookieOptions, adminErrorResponse, adminRateLimit, logoutAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    adminRateLimit(req, "logout", 20);
    await logoutAdmin(req);
    const response = NextResponse.json({ authenticated: false, wallet: null }, { headers: ADMIN_NO_STORE });
    response.cookies.set(ADMIN_CHALLENGE_COOKIE, "", adminCookieOptions(0));
    response.cookies.set(ADMIN_SESSION_COOKIE, "", adminCookieOptions(0));
    return response;
  } catch (error) { return adminErrorResponse(error); }
}
