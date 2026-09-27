import { NextResponse } from "next/server";
import { devLoginEnabled } from "@/lib/auth";
import { signerAccount } from "@/lib/signing";
import { resolverMode } from "@/lib/x";

export const dynamic = "force-dynamic";

/** Which optional server features are switched on, so the UI can adapt. */
export async function GET() {
  return NextResponse.json({
    uploads: Boolean(process.env.PINATA_JWT),
    xLogin: Boolean(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET),
    devLogin: devLoginEnabled,
    signer: Boolean(signerAccount()),
    resolver: resolverMode(),
  });
}
