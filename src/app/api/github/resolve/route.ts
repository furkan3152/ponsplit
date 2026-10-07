import { NextResponse } from "next/server";
import { GithubBusyError, resolveLogins } from "@/lib/github";
import { isValidLogin, normalizeLogin } from "@/lib/github-handles";
import { clientIp, limitClient } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** GET ?logins=a,b → { profiles: { a: { id, login, name, avatar, type } | null } } */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("logins") ?? "";
  const logins = Array.from(new Set(raw.split(",").map(normalizeLogin).filter(isValidLogin))).slice(0, 10);
  if (!logins.length) return NextResponse.json({ profiles: {} });
  // Each username counts, not each request: 40 usernames a minute per visitor.
  if (!limitClient("github", clientIp(req), 40, logins.length)) {
    return NextResponse.json({ error: "Too many lookups, slow down a little." }, { status: 429 });
  }
  try {
    return NextResponse.json({ profiles: await resolveLogins(logins) }, { headers: { "cache-control": "public, max-age=0, s-maxage=300" } });
  } catch (e) {
    const busy = e instanceof GithubBusyError;
    return NextResponse.json({ error: busy ? (e as Error).message : "GitHub couldn't be reached. Try again." }, { status: busy ? 429 : 502 });
  }
}
