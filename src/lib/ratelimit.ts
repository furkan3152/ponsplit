import "server-only";
import { isIP } from "net";

const buckets = new Map<string, { count: number; reset: number }>();
const MAX_KEYS = 10_000;

/** Fixed-window limiter per key (client IP). Good enough for one server instance. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) {
    // Drop expired windows so spoofed or one-off keys can't grow memory without bound; if that is
    // not enough, evict the oldest windows rather than resetting everyone's.
    for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
    for (const k of buckets.keys()) {
      if (buckets.size <= MAX_KEYS) break;
      buckets.delete(k);
    }
  }
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= limit;
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

function key(ip: string | undefined): string {
  if (!ip) return "unknown";
  if (isIP(ip) === 6) {
    const groups = expand6(ip);
    if (groups) return `${groups.slice(0, 4).join(":")}::/64`;
  }
  return ip;
}

function expand6(ip: string): string[] | null {
  const [head, tail] = ip.split("::");
  const a = head ? head.split(":") : [];
  const b = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  if (tail === undefined && a.length !== 8) return null;
  const fill = Array(8 - a.length - b.length).fill("0");
  return [...a, ...fill, ...b].map((g) => g.toLowerCase());
}

function isPrivate(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:10.") || l.startsWith("::ffff:127.");
  }
  return true; // not an IP at all: never trust it as a client address
}
