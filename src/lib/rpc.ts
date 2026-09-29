import { fallback, http, type HttpTransportConfig, type Transport } from "viem";

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);

/**
 * The RPC endpoints for a network, in order: the configured ones (a comma list, e.g. a paid
 * provider first), then the chain's public RPC as a backup. A local node (the e2e forks) is used
 * alone, since falling back to the real network would read a different chain state.
 */
export function rpcList(configured: string | undefined, publicUrl: string): string[] {
  const urls = (configured ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.some(isLocal)) return urls;
  return [...new Set([...urls, publicUrl])];
}

/**
 * One transport over several endpoints: each request goes to the first that answers, so an
 * outage or rate limit at one provider moves reads to the next instead of stalling the page.
 */
export function rpcTransport(urls: readonly string[], config: HttpTransportConfig = {}): Transport {
  if (urls.length === 1) return http(urls[0], config);
  // One retry per endpoint before moving on, so a failing provider doesn't hold a read for long.
  return fallback(
    urls.map((u) => http(u, { ...config, retryCount: Math.min(config.retryCount ?? 3, 1) })),
    { rank: false, retryCount: 1 }
  );
}
