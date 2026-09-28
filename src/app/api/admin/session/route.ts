import { NextResponse } from "next/server";
import { isAddress, recoverMessageAddress, type Hex } from "viem";
import { ADMIN_COOKIE, adminsConfigured, challengeFor, currentAdmin, isAdminAddress, readChallenge, sessionMaxAge, sessionValue } from "@/lib/admin";
import { readJson } from "@/lib/body";
import { NETWORK_IDS, NETWORKS } from "@/lib/networks";
import { clientIp, limitClient } from "@/lib/ratelimit";
import { serverClient } from "@/lib/server-network";

export const dynamic = "force-dynamic";

const hostOf = (req: Request) => req.headers.get("host") ?? new URL(req.url).host;

/** Whether this visitor is signed in as an admin (and whether anyone could be). */
export async function GET() {
  const admin = await currentAdmin();
  return NextResponse.json({ admin: Boolean(admin), address: admin, configured: await adminsConfigured() }, { headers: { "cache-control": "no-store" } });
}

/**
 * Sign-in, in two calls: { address } returns the message to sign; { message, signature } checks it
 * and, for an admin wallet, sets the session cookie.
 */
export async function POST(req: Request) {
  if (!limitClient("admin", clientIp(req), 20)) return NextResponse.json({ error: "Too many attempts, try again in a minute." }, { status: 429 });
  const body = await readJson<Record<string, unknown>>(req, 8 * 1024).catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const host = hostOf(req);

  if (typeof body.address === "string") {
    if (!isAddress(body.address)) return NextResponse.json({ error: "Not an address." }, { status: 400 });
    const c = challengeFor(body.address, host);
    if (!c) return NextResponse.json({ error: "The server has no signing key yet (SIGNER_PRIVATE_KEY)." }, { status: 503 });
    return NextResponse.json(c);
  }

  const { message, signature } = body;
  if (typeof message !== "string" || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const wallet = readChallenge(message, host);
  if (!wallet) return NextResponse.json({ error: "That sign-in request expired. Try again." }, { status: 400 });
  // A plain wallet signs with its key; a smart-contract wallet is checked on-chain (ERC-1271).
  let valid = await recoverMessageAddress({ message, signature: signature as Hex })
    .then((a) => a.toLowerCase() === wallet.toLowerCase())
    .catch(() => false);
  for (const id of NETWORK_IDS) {
    if (valid) break;
    valid = await serverClient(NETWORKS[id])
      .verifyMessage({ address: wallet, message, signature: signature as Hex })
      .catch(() => false);
  }
  if (!valid) return NextResponse.json({ error: "The signature doesn't match the wallet." }, { status: 401 });
  if (!(await isAdminAddress(wallet))) return NextResponse.json({ error: "This wallet isn't an admin of this site." }, { status: 403 });

  const value = sessionValue(wallet)!;
  const res = NextResponse.json({ admin: true, address: wallet });
  res.cookies.set(ADMIN_COOKIE, value, {
    httpOnly: true,
    secure: new URL(req.url).protocol === "https:",
    sameSite: "strict",
    path: "/",
    maxAge: sessionMaxAge,
  });
  return res;
}

/** Sign out. */
export async function DELETE() {
  const res = NextResponse.json({ admin: false });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
