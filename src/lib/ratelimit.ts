import "server-only";
import { ipKey as key, isPrivateIp as isPrivate } from "./ip";

const buckets = new Map<string, { count: number; reset: number }>();
const MAX_KEYS = 10_000;

function prune(now: number) {
  if (buckets.size <= MAX_KEYS) return;
  // Drop expired windows so spoofed or one-off keys can't grow memory without bound; if that is
  // not enough, evict the oldest windows rather than resetting everyone's.
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
  for (const k of buckets.keys()) {
    if (buckets.size <= MAX_KEYS) break;
    buckets.delete(k);
  }
}

/** Fixed-window limiter per key (client IP). Good enough for one server instance. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  prune(now);
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= limit;
}

/** Units still available under `limit` in the key's current window (nothing is charged). */
export function remaining(key: string, limit: number): number {
  const b = buckets.get(key);
  if (!b || Date.now() > b.reset) return limit;
  return Math.max(0, limit - b.count);
}

/** Charges `n` units to the key's window, starting a new window if the old one expired. */
export function charge(key: string, n: number, windowMs: number): void {
  if (n <= 0) return;
  const now = Date.now();
  prune(now);
  const b = buckets.get(key);
  if (!b || now > b.reset) buckets.set(key, { count: n, reset: now + windowMs });
  else b.count += n;
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
