import "server-only";
import { ipKey as key, isPrivateIp as isPrivate, networkKey } from "./ip";

type Bucket = { count: number; reset: number };

/**
 * Per-client windows live in a map that is pruned when it grows (so spoofed or one-off keys can't
 * exhaust memory). Network-wide (IPv6 /48) and global ("…:*") windows live apart and are only ever
 * dropped once expired, so flooding the first map with fresh keys can't reset them.
 */
const clientBuckets = new Map<string, Bucket>();
const sharedBuckets = new Map<string, Bucket>();
const MAX_CLIENT_KEYS = 10_000;

const isShared = (key: string) => key.endsWith(":*") || key.endsWith("::/48");
const mapFor = (key: string) => (isShared(key) ? sharedBuckets : clientBuckets);

function prune(now: number) {
  for (const map of [clientBuckets, sharedBuckets]) {
    if (map.size <= MAX_CLIENT_KEYS) continue;
    for (const [k, b] of map) if (now > b.reset) map.delete(k);
  }
  // Still too many live client windows: evict the oldest rather than resetting everyone's.
  for (const k of clientBuckets.keys()) {
    if (clientBuckets.size <= MAX_CLIENT_KEYS) break;
    clientBuckets.delete(k);
  }
}

/** Units still available under `limit` in the key's current window (nothing is charged). */
export function remaining(key: string, limit: number): number {
  const b = mapFor(key).get(key);
  if (!b || Date.now() > b.reset) return limit;
  return Math.max(0, limit - b.count);
}

/** Charges `n` units to the key's window, starting a new window if the old one expired. */
export function charge(key: string, n: number, windowMs: number): void {
  if (n <= 0) return;
  const now = Date.now();
  prune(now);
  const map = mapFor(key);
  const b = map.get(key);
  if (!b || now > b.reset) {
    map.delete(key); // re-insert so map order follows recent use
    map.set(key, { count: n, reset: now + windowMs });
  } else b.count += n;
}

/** Fixed-window limiter for one key. Good enough for one server instance. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  if (remaining(key, limit) < 1) return false;
  charge(key, 1, windowMs);
  return true;
}

/** How much more a whole network (IPv6 /48) may do than one of its clients. */
export const NETWORK_FACTOR = 3;

/**
 * Per-client limit for `scope`, plus a limit for the client's wider network (IPv6 /48), since one
 * holder of a /48 controls 65,536 /64 client keys. Both are checked before either is charged, so
 * a refused request costs nothing. Charges `n` units (default 1).
 */
export function limitClient(scope: string, ip: string, limit: number, n = 1, windowMs = 60_000): boolean {
  const net = networkKey(ip);
  const clientKey = `${scope}:${ip}`;
  const netKey = `${scope}:${net}`;
  if (remaining(clientKey, limit) < n) return false;
  if (net !== ip && remaining(netKey, limit * NETWORK_FACTOR) < n) return false;
  charge(clientKey, n, windowMs);
  if (net !== ip) charge(netKey, n, windowMs);
  return true;
}

/**
 * The client IP as reported by the hosting platform, never a header the client can freely set.
 * - TRUSTED_IP_HEADER: explicit override for other hosts.
 * - Vercel: x-vercel-forwarded-for / x-real-ip are set by Vercel's edge.
 * - Render: traffic arrives through Cloudflare, which overwrites cf-connecting-ip / true-client-ip
 *   with the real client. (X-Forwarded-For there ends with Render's internal proxy hop.)
 * - Otherwise: the right-most public X-Forwarded-For entry, i.e. the one added by the outermost
 *   proxy we trust; entries to its left can be forged by the client, private ones are our proxies.
 * IPv6 clients are keyed by their /64, since one host usually controls a whole /64.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const override = process.env.TRUSTED_IP_HEADER;
  if (override) return key(first(h.get(override)));
  if (process.env.VERCEL) return key(first(h.get("x-vercel-forwarded-for")) || first(h.get("x-real-ip")));
  if (process.env.RENDER) {
    const cf = first(h.get("cf-connecting-ip")) || first(h.get("true-client-ip"));
    if (cf) return key(cf);
  }
  const hops = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (hops.length === 0) return "local";
  for (let i = hops.length - 1; i >= 0; i--) if (!isPrivate(hops[i])) return key(hops[i]);
  return key(hops[hops.length - 1]);
}

function first(v: string | null): string | undefined {
  return v?.split(",")[0]?.trim() || undefined;
}
