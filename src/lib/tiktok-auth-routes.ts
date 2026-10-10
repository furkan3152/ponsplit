import "server-only";
import { NextResponse } from "next/server";
import { clientIp, limitClient, rateLimit } from "./ratelimit";
import { TikTokAuthError } from "./tiktok-auth";

export const TIKTOK_NO_STORE = { "cache-control": "private, no-store", "vary": "Cookie" };

export function guardTikTokRate(req: Request, scope: string, budget: number): void {
  if (!limitClient(`tiktok-${scope}`, clientIp(req), budget)) throw new TikTokAuthError("rate_limited", "Too many requests. Please wait a minute and try again.", 429);
  if (!rateLimit(`tiktok-${scope}:*`, budget * 20, 60_000)) throw new TikTokAuthError("rate_limited", "TikTok verification is busy. Please wait a minute and try again.", 429);
}

export function tiktokErrorResponse(error: unknown): NextResponse {
  if (error instanceof TikTokAuthError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: TIKTOK_NO_STORE });
  return NextResponse.json({ error: "Verification could not be completed. Please try again.", code: "service_unavailable" }, { status: 502, headers: TIKTOK_NO_STORE });
}
