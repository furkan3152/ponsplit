import { NextResponse } from "next/server";
import { adminKeyProblem } from "@/lib/adminKey";
import { signerAccount } from "@/lib/signing";
import { resolverMode } from "@/lib/x";

export const dynamic = "force-dynamic";

/**
 * Which optional server features are switched on, so the UI can adapt, and the address the server
 * signs as (public: FeeVault is deployed trusting it, and /setup compares it with the vault's).
 */
export async function GET() {
  return NextResponse.json({
    uploads: Boolean(process.env.PINATA_JWT || process.env.BLOB_READ_WRITE_TOKEN),
    xLogin: Boolean(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET),
    signer: signerAccount()?.address ?? null,
    keyProblem: adminKeyProblem() ?? null,
    resolver: resolverMode(),
  });
}
