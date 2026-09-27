import { NextResponse } from "next/server";
import { isValidHandle, normalizeHandle } from "@/lib/handles";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { resolveHandles } from "@/lib/x";

export const dynamic = "force-dynamic";

/** GET /api/x/resolve?handles=a,b → { profiles: { a: {id, username, name, image} | null } } */
export async function GET(req: Request) {
  if (!rateLimit(`resolve:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many lookups, slow down a little." }, { status: 429 });
  }
  const raw = new URL(req.url).searchParams.get("handles") ?? "";
  const handles = raw.split(",").map(normalizeHandle).filter(isValidHandle).slice(0, 10);
  if (handles.length === 0) return NextResponse.json({ profiles: {} });
  try {
    return NextResponse.json({ profiles: await resolveHandles(handles) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
