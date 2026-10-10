export type TokenMetadata = {
  image?: string;
  description?: string;
  website?: string;
  telegram?: string;
  twitter?: string;
  tiktok?: string;
};

const IPFS_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://ipfs.io/ipfs/";

/** Only http(s) links are ever rendered; everything else is dropped. */
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 400) return undefined;
  if (value.startsWith("ipfs://")) return IPFS_GATEWAY + value.slice(7).replace(/^ipfs\//, "");
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function parseMetadata(raw: string): TokenMetadata {
  try {
    const m = JSON.parse(raw) as Record<string, unknown>;
    return {
      image: safeUrl(m.image),
      description: typeof m.description === "string" ? m.description.slice(0, 600) : undefined,
      website: safeUrl(m.website),
      telegram: safeUrl(m.telegram),
      twitter: safeUrl(m.twitter),
      tiktok: safeUrl(m.tiktok),
    };
  } catch {
    return {};
  }
}

export function encodeMetadata(m: TokenMetadata): string {
  const clean = Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === "string" && v.trim() !== ""));
  return JSON.stringify(clean);
}
