import { PublicKey } from "@solana/web3.js";
import { readJson } from "@/lib/body";
import { clientIp, limitClient, rateLimit } from "@/lib/ratelimit";
import { TREASURY } from "@/lib/solana/config";
import { ESCROW_PROGRAM_ID, VERIFIER } from "@/lib/tiktok-config";
import { accountScanRequest } from "@/lib/solana/public-accounts";
import { PublicAccountReadError, readPublicProgramAccounts } from "@/lib/solana/public-account-reader";
import { configuredProgramStatus } from "@/lib/admin-setup";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "cache-control": "no-store" };

/** No arbitrary methods, destinations or account scans. Never signs or broadcasts transactions. */
export async function POST(req: Request) {
  const deadline = Date.now() + 25_000;
  if (!limitClient("public-accounts", clientIp(req), 12) || !rateLimit("public-accounts:*", 60, 60_000)) {
    return Response.json({ error: "Account reads are busy. Retry shortly." }, { status: 429, headers });
  }
  const scan = accountScanRequest(await readJson(req, 2048), {
    treasury: TREASURY?.toBase58() ?? null, program: ESCROW_PROGRAM_ID?.toBase58() ?? null, verifier: VERIFIER?.toBase58() ?? null,
  });
  if (!scan) return Response.json({ error: "Unsupported account read." }, { status: 400, headers });
  let stage = "deployment-verification";
  try {
    // Unknown owner-program scans require our pinned executable and admin authority first.
    if (scan.verifyDeployment && !(await configuredProgramStatus(new PublicKey(scan.program))).artifactMatches) {
      return Response.json({ error: "Unverified deployment. Account scan refused." }, { status: 400, headers });
    }
    stage = "account-scan";
    const result = await readPublicProgramAccounts(scan.request, { deadline });
    return Response.json({ jsonrpc: "2.0", id: scan.request.id, result }, { headers });
  } catch (error) {
    const scanError = error instanceof PublicAccountReadError ? error : undefined;
    console.warn("Public Solana account read failed", {
      stage, attempts: scanError?.attempts, status: scanError?.status, rpcCode: scanError?.rpcCode,
    });
    return Response.json({
      error: "Public Solana account reads are unavailable. Retry shortly; no transaction was sent by this request.",
      code: stage === "account-scan" ? "ACCOUNT_SCAN_UNAVAILABLE" : "DEPLOYMENT_READ_UNAVAILABLE",
    }, { status: 503, headers: { ...headers, "retry-after": String(scanError?.retryAfterSeconds ?? 5) } });
  }
}
