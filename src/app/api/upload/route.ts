import { NextResponse } from "next/server";
import { readBody } from "@/lib/body";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
/** Multipart framing around the file (boundaries, headers, filename). */
const MAX_REQUEST_BYTES = MAX_BYTES + 64 * 1024;

/** The file's real type from its first bytes; the browser-declared type is not trusted. */
function sniff(b: Uint8Array): string | null {
  const at = (i: number, bytes: number[]) => bytes.every((x, j) => b[i + j] === x);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}

/** POST multipart { file } → { uri: "ipfs://…" }. Pins to IPFS through Pinata when PINATA_JWT is set. */
export async function POST(req: Request) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return NextResponse.json({ error: "Uploads are not configured; paste an image URL instead." }, { status: 501 });
  if (!rateLimit(`upload:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many uploads, try again in a minute." }, { status: 429 });
  }

  const raw = await readBody(req, MAX_REQUEST_BYTES).catch(() => null);
  if (!raw) return NextResponse.json({ error: "Images must be under 2 MB." }, { status: 413 });
  const form = await new Request(req.url, {
    method: "POST",
    headers: { "content-type": req.headers.get("content-type") ?? "" },
    body: raw,
  })
    .formData()
    .catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Images must be under 2 MB." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes);
  if (!type) return NextResponse.json({ error: "Use a PNG, JPG, WEBP or GIF." }, { status: 400 });

  const upstream = new FormData();
  upstream.append("file", new Blob([bytes], { type }), `image.${type.split("/")[1]}`);
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
    body: upstream,
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res?.ok) return NextResponse.json({ error: `Upload failed (${res?.status ?? "network"}).` }, { status: 502 });
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return NextResponse.json({ uri: `ipfs://${IpfsHash}` });
}
