import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { isValidHandle, normalizeHandle } from "@/lib/handles";
import { signerAccount } from "@/lib/signing";
import { proofCode, proofText } from "@/lib/xproof";

export const dynamic = "force-dynamic";

/** POST { handle, wallet } → the text to post on X to prove ownership of @handle for this wallet. */
export async function POST(req: Request) {
  if (!signerAccount()) return NextResponse.json({ error: "Claims are not configured on this server." }, { status: 500 });
  const body = (await req.json().catch(() => null)) as { handle?: string; wallet?: string } | null;
  const handle = normalizeHandle(body?.handle ?? "");
  if (!isValidHandle(handle)) return NextResponse.json({ error: "Enter your X username." }, { status: 400 });
  if (!body?.wallet || !isAddress(body.wallet)) return NextResponse.json({ error: "Connect a wallet first." }, { status: 400 });
  const wallet = getAddress(body.wallet);
  const text = proofText(handle, wallet);
  return NextResponse.json({
    code: proofCode(handle, wallet),
    text,
    intentUrl: `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
  });
}
