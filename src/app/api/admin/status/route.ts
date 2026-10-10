import { ADMIN_NO_STORE, adminErrorResponse, adminRateLimit, requireAdmin } from "@/lib/admin-auth";
import { runtimeStatus } from "@/lib/runtime-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  try {
    adminRateLimit(req, "setup-status", 20);
    await requireAdmin(req);
    return Response.json(await runtimeStatus(), { headers: ADMIN_NO_STORE });
  } catch (error) { return adminErrorResponse(error); }
}
