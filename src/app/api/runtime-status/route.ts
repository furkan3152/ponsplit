import { runtimeStatus } from "@/lib/runtime-status";
import { clientIp, limitClient } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!limitClient("runtime-status", clientIp(req), 30)) return Response.json({ error: "Please wait before checking readiness again." }, { status: 429, headers: { "cache-control": "no-store" } });
  try {
    return Response.json(await runtimeStatus(), { headers: { "cache-control": "public, max-age=0, s-maxage=5" } });
  } catch {
    return Response.json({ error: "Runtime readiness could not be checked.", launchesReady: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
