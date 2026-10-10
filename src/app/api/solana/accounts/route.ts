import { PublicKey } from "@solana/web3.js";
import { readJson } from "@/lib/body";
import { clientIp, limitClient, rateLimit } from "@/lib/ratelimit";
import { TREASURY } from "@/lib/solana/config";
import { ESCROW_PROGRAM_ID, VERIFIER } from "@/lib/tiktok-config";
import { accountScanRequest } from "@/lib/solana/public-accounts";
import { PUBLIC_INDEX_RPC } from "@/lib/solana/rpc";
import { configuredProgramStatus } from "@/lib/admin-setup";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "cache-control": "no-store" };

/** No arbitrary methods, destinations or account scans. Never signs or broadcasts transactions. */
export async function POST(req: Request) {
  if (!limitClient("public-accounts", clientIp(req), 12) || !rateLimit("public-accounts:*", 60, 60_000)) {
    return Response.json({ error: "Account reads are busy. Retry shortly." }, { status: 429, headers });
  }
  const scan = accountScanRequest(await readJson(req, 2048), {
    treasury: TREASURY?.toBase58() ?? null, program: ESCROW_PROGRAM_ID?.toBase58() ?? null, verifier: VERIFIER?.toBase58() ?? null,
  });
  if (!scan) return Response.json({ error: "Unsupported account read." }, { status: 400, headers });
  try {
    // Unknown owner-program scans require our pinned executable and admin authority first.
    if (scan.verifyDeployment && !(await configuredProgramStatus(new PublicKey(scan.program))).artifactMatches) {
      return Response.json({ error: "Unverified deployment. Account scan refused." }, { status: 400, headers });
    }
    const upstream = await fetch(PUBLIC_INDEX_RPC, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(scan.request),
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) throw new Error("Public RPC unavailable");
    const result = await upstream.json();
    if (result.error || !Array.isArray(result.result)) throw new Error("Public RPC rejected the account scan");
    return Response.json({ jsonrpc: "2.0", id: scan.request.id, result: result.result }, { headers });
  } catch {
    return Response.json({ error: "Public Solana account reads are unavailable. Retry shortly; no transaction was sent by this request." }, { status: 503, headers });
  }
}
