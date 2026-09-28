import { NextResponse } from "next/server";
import { clientIp, limitClient } from "@/lib/ratelimit";
import { runSetup, setupStatus } from "@/lib/setup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET → where setup stands. Only public data (addresses, balance, nonce). */
export async function GET() {
  try {
    return NextResponse.json(await setupStatus());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/**
 * POST → deploys whatever is missing. Needs no auth: it can only deploy the canonical contracts
 * from the server's own admin key, once, and every step is derived from on-chain state.
 */
export async function POST(req: Request) {
  if (!limitClient("setup", clientIp(req), 5)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  try {
    return NextResponse.json(await runSetup());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.split("\n")[0] }, { status: 400 });
  }
}
