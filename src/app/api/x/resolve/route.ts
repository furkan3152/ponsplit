import { NextResponse } from "next/server";
import { isValidHandle, normalizeHandle } from "@/lib/handles";
import { clientIp, limitClient } from "@/lib/ratelimit";
import { ResolverBusyError, resolveHandles } from "@/lib/x";

export const dynamic = "force-dynamic";

/**
 * GET /api/x/resolve?handles=a,b → { profiles: { a: {id, username, name, image} | null }, incomplete: [b] }
 * (previews only). `incomplete` lists handles that didn't fit the lookup budget this minute.
 */
export async function GET(req: Request) {
  const ip = clientIp(req);
  if (!limitClient("resolve", ip, 30)) {
    return NextResponse.json({ error: "Too many lookups, slow down a little." }, { status: 429 });
  }
  const raw = new URL(req.url).searchParams.get("handles") ?? "";
  const handles = Array.from(new Set(raw.split(",").map(normalizeHandle).filter(isValidHandle))).slice(0, 10);
  if (handles.length === 0) return NextResponse.json({ profiles: {}, incomplete: [] });
  try {
    const profiles = await resolveHandles(handles, "display", ip);
    return NextResponse.json({ profiles, incomplete: handles.filter((h) => !(h in profiles)) });
  } catch (e) {
    const busy = e instanceof ResolverBusyError;
    return NextResponse.json({ error: (e as Error).message }, { status: busy ? 429 : 502 });
  }
}
