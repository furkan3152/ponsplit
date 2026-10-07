import { createHash } from "crypto";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { readBody } from "@/lib/body";
import { MAX_IMAGE_SIDE, imageSize, imageWithinLimits, sniffImage } from "@/lib/image-bytes";
import { clientIp, limitClient, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
/** Multipart framing around the file (boundaries, headers, filename). */
const MAX_REQUEST_BYTES = MAX_BYTES + 64 * 1024;

/**
 * POST multipart { file } → { uri }. Stores the coin image on Vercel Blob when the site's Blob store
 * is connected (BLOB_READ_WRITE_TOKEN, set by Vercel), else pins it to IPFS through Pinata
 * (PINATA_JWT). The image is checked from its bytes first: type, real pixel size, file size.
 */
export async function POST(req: Request) {
  const jwt = process.env.PINATA_JWT;
  const blob = process.env.BLOB_READ_WRITE_TOKEN;
  if (!jwt && !blob) return NextResponse.json({ error: "Uploads are not configured; paste an image URL instead." }, { status: 501 });
  if (!limitClient("upload", clientIp(req), 10)) {
    return NextResponse.json({ error: "Too many uploads, try again in a minute." }, { status: 429 });
  }
  // A site-wide daily cap (per server instance), so nobody can use the owner's storage as free hosting.
  if (!rateLimit("upload:*", 500, 86_400_000)) return NextResponse.json({ error: "Uploads are paused for today. Paste an image link instead." }, { status: 429 });

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
  // The real type and size from the bytes; the browser-declared type is not trusted.
  const type = sniffImage(bytes);
  if (!type) return NextResponse.json({ error: "Use a PNG, JPG, WEBP or GIF." }, { status: 400 });
  if (!imageSize(bytes)) {
    return NextResponse.json({ error: "Couldn't read this image. Re-save it as PNG or JPG and try again." }, { status: 400 });
  }
  if (!imageWithinLimits(bytes)) {
    return NextResponse.json({ error: `Images can be at most ${MAX_IMAGE_SIDE}×${MAX_IMAGE_SIDE} pixels.` }, { status: 400 });
  }

  const ext = type.split("/")[1];
  if (blob) {
    // Content-addressed name: the same picture uploaded twice keeps one URL.
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    const stored = await put(`coins/${hash}.${ext}`, Buffer.from(bytes), {
      access: "public",
      contentType: type,
      token: blob,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31_536_000,
    }).catch(() => null);
    if (!stored) return NextResponse.json({ error: "Upload failed, try again." }, { status: 502 });
    return NextResponse.json({ uri: stored.url });
  }

  const upstream = new FormData();
  upstream.append("file", new Blob([bytes], { type }), `image.${ext}`);
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
