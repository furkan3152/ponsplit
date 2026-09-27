import "server-only";

const buckets = new Map<string, { count: number; reset: number }>();
const MAX_KEYS = 10_000;

/** Fixed-window limiter per key (client IP). Good enough for one server instance. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) {
    // Drop expired windows so spoofed or one-off keys can't grow memory without bound.
    for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
    if (buckets.size > MAX_KEYS) buckets.clear();
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
 * - Otherwise (Render, most reverse proxies): the right-most X-Forwarded-For entry, which is the
 *   one appended by the proxy in front of us; entries to its left can be forged by the client.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const override = process.env.TRUSTED_IP_HEADER;
  if (override) return first(h.get(override)) || "unknown";
  if (process.env.VERCEL) return first(h.get("x-vercel-forwarded-for")) || first(h.get("x-real-ip")) || "unknown";
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",").map((s) => s.trim()).filter(Boolean).pop() || "unknown";
  return "local";
}

function first(v: string | null): string | undefined {
  return v?.split(",")[0]?.trim() || undefined;
}
