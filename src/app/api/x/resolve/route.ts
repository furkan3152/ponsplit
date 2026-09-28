import { NextResponse } from "next/server";
import { isValidHandle, normalizeHandle } from "@/lib/handles";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { ResolverBusyError, resolveHandles } from "@/lib/x";

export const dynamic = "force-dynamic";

/** GET /api/x/resolve?handles=a,b → { profiles: { a: {id, username, name, image} | null } } (previews only). */
export async function GET(req: Request) {
  const ip = clientIp(req);
  if (!rateLimit(`resolve:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many lookups, slow down a little." }, { status: 429 });
  }
  const raw = new URL(req.url).searchParams.get("handles") ?? "";
  const handles = raw.split(",").map(normalizeHandle).filter(isValidHandle).slice(0, 10);
  if (handles.length === 0) return NextResponse.json({ profiles: {} });
  try {
    return NextResponse.json({ profiles: await resolveHandles(handles, "display", ip) });
  } catch (e) {
    const busy = e instanceof ResolverBusyError;
    return NextResponse.json({ error: (e as Error).message }, { status: busy ? 429 : 502 });
  }
}
