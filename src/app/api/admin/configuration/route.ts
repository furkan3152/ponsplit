import { ADMIN_NO_STORE, AdminAuthError, adminErrorResponse, adminRateLimit, assertAdminOrigin, requireAdmin } from "@/lib/admin-auth";
import { applyVercelConfiguration, configuredProgramStatus, validVerifier } from "@/lib/admin-setup";
import { readJson } from "@/lib/body";
import { PublicKey } from "@solana/web3.js";
import { ESCROW_PROGRAM_ID, VERIFIER } from "@/lib/tiktok-config";
import { ADMIN_WALLET } from "@/lib/admin-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    assertAdminOrigin(req);
    adminRateLimit(req, "configuration", 5);
    const body = await readJson<{ programId?: unknown; verifier?: unknown }>(req);
    let program: PublicKey;
    let verifier: PublicKey;
    try {
      if (typeof body?.programId !== "string" || body.programId.length > 44 || typeof body.verifier !== "string" || body.verifier.length > 44) throw new Error();
      program = new PublicKey(body.programId);
      verifier = validVerifier(body.verifier);
      if (program.equals(PublicKey.default) || program.equals(verifier)) throw new Error();
    } catch { throw new AdminAuthError("invalid_configuration", "Enter valid escrow and managed verifier public addresses.", 400); }
    if ((ESCROW_PROGRAM_ID && !program.equals(ESCROW_PROGRAM_ID)) || (VERIFIER && !verifier.equals(VERIFIER))) throw new AdminAuthError("migration_required", "Changing an active escrow program or verifier requires a migration plan that preserves existing creator claims. This setup form only accepts the current public addresses once configured.", 409);
    const status = await configuredProgramStatus(program).catch(() => { throw new AdminAuthError("rpc_unavailable", "The program could not be checked on mainnet. No hosting changes were made.", 503); });
    if (!status.deployed || status.artifactMatches !== true || status.upgradeAuthority !== ADMIN_WALLET.toBase58()) throw new AdminAuthError("unsafe_program", "This program does not match the reviewed artifact with the configured admin as upgrade authority.", 422);
    const values = { NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID: program.toBase58(), NEXT_PUBLIC_TIKSPLIT_VERIFIER: verifier.toBase58() };
    const result = await applyVercelConfiguration(values).catch(() => { throw new AdminAuthError("hosting_unavailable", "Hosting configuration failed. Check Vercel environment values and redeploy before using the new program.", 502); });
    return Response.json({ values, ...result }, { headers: ADMIN_NO_STORE });
  } catch (error) { return adminErrorResponse(error); }
}
