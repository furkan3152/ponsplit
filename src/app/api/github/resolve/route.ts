import { NextResponse } from "next/server";
import { GithubBusyError, resolveLogins } from "@/lib/github";
import { isValidLogin, normalizeLogin } from "@/lib/github-handles";
import { clientIp, limitClient } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** GET ?logins=a,b → { profiles: { a: { id, login, name, avatar, type } | null } } */
export async function GET(req: Request) {
  if (!limitClient("github", clientIp(req), 40)) {
    return NextResponse.json({ error: "Too many lookups, slow down a little." }, { status: 429 });
  }
  const raw = new URL(req.url).searchParams.get("logins") ?? "";
  const logins = Array.from(new Set(raw.split(",").map(normalizeLogin).filter(isValidLogin))).slice(0, 10);
  if (!logins.length) return NextResponse.json({ profiles: {} });
  try {
    return NextResponse.json({ profiles: await resolveLogins(logins) }, { headers: { "cache-control": "public, max-age=0, s-maxage=300" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof GithubBusyError ? 429 : 502 });
  }
}
