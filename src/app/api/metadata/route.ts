import { createHash } from "crypto";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { readJson } from "@/lib/body";
import { safeUrl } from "@/lib/metadata";
import { clientIp, limitClient, rateLimit } from "@/lib/ratelimit";
import { memoryMetadata } from "./store";

export const dynamic = "force-dynamic";

/**
 * POST { name, symbol, description, image, website, twitter, telegram } → { uri }: the coin's
 * metadata JSON in pump.fun's format, stored on Vercel Blob (or IPFS through Pinata). pump.fun and
 * wallets read the coin's picture and links from it.
 */
export async function POST(req: Request) {
  const jwt = process.env.PINATA_JWT;
  const blob = process.env.BLOB_READ_WRITE_TOKEN;
  // The local end-to-end test has no storage service: it keeps metadata in this server's memory.
  const memory = process.env.SPLIDEV_METADATA_STORE === "memory";
  if (!jwt && !blob && !memory) return NextResponse.json({ error: "Metadata storage is not configured on this server." }, { status: 501 });
  if (!limitClient("metadata", clientIp(req), 10)) return NextResponse.json({ error: "Too many requests, try again in a minute." }, { status: 429 });
  if (!rateLimit("metadata:*", 1_000, 86_400_000)) return NextResponse.json({ error: "Launches are paused for today. Try again tomorrow." }, { status: 429 });
  const body = await readJson<Record<string, unknown>>(req);
  const str = (k: string, max: number) => (typeof body?.[k] === "string" ? (body[k] as string).trim().slice(0, max) : "");
  const name = str("name", 32);
  const symbol = str("symbol", 13);
  if (!name || !symbol) return NextResponse.json({ error: "A name and a ticker are required." }, { status: 400 });
  const link = (k: string) => (str(k, 200) && safeUrl(str(k, 200))) || undefined;
  const meta = {
    name,
    symbol,
    description: str("description", 500),
    image: link("image") ?? "",
    showName: true,
    createdOn: "https://splitdev.app",
    ...(link("website") ? { website: link("website") } : {}),
    ...(link("twitter") ? { twitter: link("twitter") } : {}),
    ...(link("telegram") ? { telegram: link("telegram") } : {}),
  };
  const json = JSON.stringify(meta);
  if (memory) {
    const id = createHash("sha256").update(json).digest("hex").slice(0, 16);
    memoryMetadata.set(id, json);
    return NextResponse.json({ uri: `${new URL(req.url).origin}/api/metadata/${id}` });
  }
  if (blob) {
    // The link goes into the launch transaction, which has little room: keep it short.
    const hash = createHash("sha256").update(json).digest("hex").slice(0, 16);
    const stored = await put(`m/${hash}`, json, {
      access: "public",
      contentType: "application/json",
      token: blob,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31_536_000,
    }).catch(() => null);
    if (!stored) return NextResponse.json({ error: "Saving the metadata failed, try again." }, { status: 502 });
    return NextResponse.json({ uri: stored.url });
  }
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ pinataContent: meta }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res?.ok) return NextResponse.json({ error: `Saving the metadata failed (${res?.status ?? "network"}).` }, { status: 502 });
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return NextResponse.json({ uri: `https://ipfs.io/ipfs/${IpfsHash}` });
}
