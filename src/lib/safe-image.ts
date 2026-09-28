import "server-only";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { imageWithinLimits, satoriCanSizeJpeg, sniffImage } from "./image-bytes";

/**
 * Downloads a user-supplied image (coin metadata) for server-side rendering without letting the
 * URL reach our private network or exhaust memory: https only, public addresses only (checked
 * after DNS and on every redirect), 3 s timeout, 2 MB cap, the bytes must really be a PNG, JPEG or GIF,
 * and its real dimensions must be modest (a tiny file can declare a canvas that would decode to
 * gigabytes). Returns a data: URL, or null on any problem.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const TTL_MS = 10 * 60 * 1000;
/** Cached data URLs are capped by total size, not count. */
const MAX_CACHE_CHARS = 24 * 1024 * 1024;
const cache = new Map<string, { at: number; value: string | null }>();
let cacheChars = 0;
const inflight = new Map<string, Promise<string | null>>();

export async function fetchImageDataUrl(url: string): Promise<string | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  // Concurrent requests for the same image share one download.
  let pending = inflight.get(url);
  if (!pending) {
    pending = download(url)
      .catch(() => null)
      .then((value) => {
        remember(url, value);
        return value;
      })
      .finally(() => inflight.delete(url));
    inflight.set(url, pending);
  }
  return pending;
}

function remember(url: string, value: string | null) {
  const old = cache.get(url);
  if (old) {
    cacheChars -= old.value?.length ?? 0;
    cache.delete(url);
  }
  cache.set(url, { at: Date.now(), value });
  cacheChars += value?.length ?? 0;
  for (const [k, v] of cache) {
    if (cacheChars <= MAX_CACHE_CHARS && cache.size <= 500) break;
    cache.delete(k);
    cacheChars -= v.value?.length ?? 0;
  }
}

async function download(start: string): Promise<string | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (u.port && u.port !== "443") return null;
    if (!(await isPublicHost(u.hostname))) return null;

    const res = await fetch(u, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(3_000) });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!next) return null;
      url = new URL(next, u).toString();
      continue;
    }
    if (!res.ok || !res.body) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
      await res.body.cancel().catch(() => {});
      return null;
    }
    const bytes = await readCapped(res.body);
    if (!bytes) return null;
    // The OG renderer draws PNG, JPEG and GIF (first frame); WebP falls back to the initials card.
    const type = sniffImage(bytes);
    if ((type !== "image/png" && type !== "image/jpeg" && type !== "image/gif") || !imageWithinLimits(bytes)) return null;
    // The renderer's own JPEG parser is stricter than decoders; files it can't read would break the card.
    if (type === "image/jpeg" && !satoriCanSizeJpeg(bytes)) return null;
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  }
  return null;
}

async function readCapped(body: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPublicIp(host);
  if (!host.includes(".") || /\.(local|internal|localhost)$/i.test(host)) return false;
  const addrs = await lookup(host, { all: true, verbatim: true }).catch(() => []);
  return addrs.length > 0 && addrs.every((a) => isPublicIp(a.address));
}

function isPublicIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  const l = ip.toLowerCase();
  if (l.startsWith("::ffff:")) return isIP(l.slice(7)) === 4 && isPublicIp(l.slice(7));
  if (l === "::" || l === "::1") return false;
  if (/^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith("ff") || l.startsWith("2001:db8")) return false;
  if (l.startsWith("64:ff9b") || l.startsWith("2002:")) return false; // NAT64 / 6to4 can map to private v4
  return true;
}
