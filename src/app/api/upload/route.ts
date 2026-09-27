import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** POST multipart { file } → { uri: "ipfs://…" }. Pins to IPFS through Pinata when PINATA_JWT is set. */
export async function POST(req: Request) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return NextResponse.json({ error: "Uploads are not configured; paste an image URL instead." }, { status: 501 });
  if (!rateLimit(`upload:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many uploads, try again in a minute." }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file." }, { status: 400 });
  if (!TYPES.includes(file.type)) return NextResponse.json({ error: "Use a PNG, JPG, WEBP or GIF." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Images must be under 2 MB." }, { status: 400 });

  const upstream = new FormData();
  upstream.append("file", file, file.name || "image");
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
    body: upstream,
  });
  if (!res.ok) return NextResponse.json({ error: `Upload failed (${res.status}).` }, { status: 502 });
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return NextResponse.json({ uri: `ipfs://${IpfsHash}` });
}
