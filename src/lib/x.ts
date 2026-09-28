import "server-only";
import { keccak256, toBytes } from "viem";
import { isValidHandle, normalizeHandle } from "./handles";
import { charge, remaining } from "./ratelimit";

export type XProfile = { id: string; username: string; name: string; image?: string };

type Mode = "x-api" | "fxtwitter" | "mock";

export function resolverMode(): Mode {
  const m = process.env.X_RESOLVER as Mode | undefined;
  if (m === "mock" || m === "x-api" || m === "fxtwitter") return m;
  return process.env.X_BEARER_TOKEN ? "x-api" : "fxtwitter";
}

/** Deterministic fake ids for local development. Must match mockXId in contracts/scripts/local-demo.js. */
export function mockXId(handle: string): bigint {
  return (BigInt(keccak256(toBytes(`mock-x:${handle}`))) >> 200n) + 1n;
}

const TTL_MS = 10 * 60 * 1000;
/** Unknown usernames can be registered at any moment, so "doesn't exist" is remembered briefly. */
const MISS_TTL_MS = 2 * 60 * 1000;
const MAX_CACHE = 5_000;
const cache = new Map<string, { at: number; profile: XProfile | null }>();

function cached(h: string): XProfile | null | undefined {
  const hit = cache.get(h);
  if (!hit) return undefined;
  if (Date.now() - hit.at > (hit.profile ? TTL_MS : MISS_TTL_MS)) {
    cache.delete(h);
    return undefined;
  }
  return hit.profile;
}

function remember(h: string, profile: XProfile | null) {
  cache.delete(h); // re-insert so Map order stays oldest-first
  cache.set(h, { at: Date.now(), profile });
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
}

/**
 * Upstream lookups (handles not in the cache) are budgeted, separately for previews ("display")
 * and launch attestations ("attest"), at three levels: per client (IP; IPv6 per /64), per wider
 * network (IPv6 /48, IPv4 as is) and globally per minute. Lookups that find no account cost more
 * (spraying random names is the cheap way to burn a budget; real launches name real accounts), and
 * a client that keeps missing is cut off for the minute. Budgets are checked before anything is
 * charged, so a refused request costs nothing. Cached answers never cost anything and are always
 * returned; previews that don't fit just stay unresolved.
 */
const LIMITS = {
  display: { client: 20, network: 60, global: 120, misses: 20 },
  attest: { client: 30, network: 90, global: 600, misses: 10 },
} as const;
const MISS_WEIGHT = 3;
const WINDOW_MS = 60_000;

type Purpose = "display" | "attest";

/**
 * How many of `n` lookups the budgets allow right now (0..n). Charges nothing. A batched request
 * (one X API call for the whole launch) costs 1 globally but still n per client and network.
 */
function available(purpose: Purpose, client: string, n: number, batched: boolean): number {
  const l = LIMITS[purpose];
  if (remaining(`x-misses:${purpose}:${client}`, l.misses) === 0) return 0;
  const clientLeft = Math.min(remaining(`x-lookups:${purpose}:${client}`, l.client), remaining(`x-lookups:${purpose}:${networkKey(client)}`, l.network));
  const globalLeft = remaining(`x-lookups:${purpose}:*`, l.global);
  if (batched) return clientLeft >= n && globalLeft >= 1 ? n : 0;
  return Math.min(n, clientLeft, globalLeft);
}

function spend(purpose: Purpose, client: string, units: number, globalUnits: number) {
  charge(`x-lookups:${purpose}:${client}`, units, WINDOW_MS);
  charge(`x-lookups:${purpose}:${networkKey(client)}`, units, WINDOW_MS);
  charge(`x-lookups:${purpose}:*`, globalUnits, WINDOW_MS);
}

/** Wider-network key: IPv6 clients (keyed per /64) are also grouped per /48. */
function networkKey(client: string): string {
  const m = /^([0-9a-f]+:[0-9a-f]+:[0-9a-f]+):[0-9a-f]+::\/64$/i.exec(client);
  return m ? `${m[1]}::/48` : client;
}

export class ResolverBusyError extends Error {
  constructor() {
    super("Profile lookups are busy right now. Try again in a minute.");
  }
}

/**
 * Resolves usernames to X accounts. Returns a map from normalized handle to profile, or null for
 * accounts that do not exist. Throws when the upstream lookup itself fails.
 *
 * `client` identifies the caller (its IP) for the lookup budgets above. A launch that doesn't fit
 * throws ResolverBusyError; a preview returns what it can. `purpose: "display"` is for previews: in x-api mode it
 * uses the free fxtwitter mirror so the X API quota is kept for `purpose: "attest"`, the lookup a
 * launch actually depends on.
 *
 * Modes:
 *  - x-api:     official X API v2 users lookup (needs X_BEARER_TOKEN; most reliable). Falls back
 *               to fxtwitter when X rate-limits us.
 *  - fxtwitter: the public api.fxtwitter.com mirror (no key; unofficial, best effort)
 *  - mock:      fake deterministic ids for local development only
 */
export async function resolveHandles(
  input: string[],
  purpose: Purpose,
  client: string
): Promise<Record<string, XProfile | null>> {
  const handles = Array.from(new Set(input.map(normalizeHandle))).filter(isValidHandle);
  const mode = resolverMode();
  // Results are cached per source. In x-api mode a launch only trusts X API answers, while
  // previews may reuse either.
  const readable: Source[] = mode === "mock" ? ["mock"] : mode === "x-api" && purpose === "attest" ? ["x"] : ["x", "fx"];
  const out: Record<string, XProfile | null> = {};
  const missing: string[] = [];
  for (const h of handles) {
    const hit = readable.map((src) => cached(`${src}:${h}`)).find((p) => p !== undefined);
    if (hit !== undefined) out[h] = hit;
    else missing.push(h);
  }
  if (missing.length === 0) return out;

  let fresh: Record<string, XProfile>;
  let source: Source;
  if (mode === "mock") {
    [fresh, source] = [resolveMock(missing), "mock"];
  } else {
    // One batched X API request serves a whole launch; fxtwitter is one request per handle.
    const batched = purpose === "attest" && mode === "x-api";
    const allowed = available(purpose, client, missing.length, batched);
    // A launch needs every account resolved; a preview shows what fits and leaves the rest unknown.
    if (purpose === "attest" && allowed < missing.length) throw new ResolverBusyError();
    if (allowed === 0) return out;
    missing.splice(allowed);
    spend(purpose, client, allowed, batched ? 1 : allowed);
    if (purpose === "display") {
      [fresh, source] = [await resolveFx(missing), "fx"];
    } else if (mode === "x-api") {
      try {
        [fresh, source] = [await resolveXApi(missing), "x"];
      } catch (e) {
        if (!(e instanceof XApiRateLimited)) throw e;
        [fresh, source] = [await resolveFx(missing), "fx"];
      }
    } else {
      [fresh, source] = [await resolveFx(missing), "fx"];
    }
  }

  let misses = 0;
  for (const h of missing) {
    out[h] = fresh[h] ?? null;
    if (out[h] === null) misses++;
    remember(`${source}:${h}`, out[h]);
  }
  if (misses && mode !== "mock") {
    charge(`x-misses:${purpose}:${client}`, misses, WINDOW_MS);
    // Misses also weigh more against the client's lookup budget.
    charge(`x-lookups:${purpose}:${client}`, misses * (MISS_WEIGHT - 1), WINDOW_MS);
  }
  return out;
}

type Source = "x" | "fx" | "mock";

/** The FxTwitter API asks every client to identify itself with a descriptive User-Agent. */
const FX_HEADERS = { "user-agent": "PonSplit/1.0 (+https://github.com/furkan3152/ponsplit)" };

/** GET from the FxTwitter API, retrying once after a short pause if it rate-limits us. */
export async function fxFetch(url: string): Promise<Response> {
  const get = () => fetch(url, { cache: "no-store", headers: FX_HEADERS, signal: AbortSignal.timeout(8_000) });
  const res = await get();
  if (res.status !== 429) return res;
  await new Promise((r) => setTimeout(r, 750));
  return get();
}

function resolveMock(handles: string[]) {
  return Object.fromEntries(handles.map((h) => [h, { id: mockXId(h).toString(), username: h, name: h }]));
}

class XApiRateLimited extends Error {}

async function resolveXApi(handles: string[]) {
  const url = `https://api.x.com/2/users/by?usernames=${handles.join(",")}&user.fields=profile_image_url`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 429) throw new XApiRateLimited("X API rate limited");
  if (!res.ok) throw new Error(`X API lookup failed (${res.status})`);
  const body = (await res.json()) as { data?: { id: string; username: string; name: string; profile_image_url?: string }[] };
  const out: Record<string, XProfile> = {};
  for (const u of body.data ?? []) {
    out[u.username.toLowerCase()] = {
      id: u.id,
      username: u.username.toLowerCase(),
      name: u.name,
      image: u.profile_image_url?.replace("_normal", "_200x200"),
    };
  }
  return out;
}

async function resolveFx(handles: string[]) {
  const results = await Promise.all(
    handles.map(async (h) => {
      const res = await fxFetch(`https://api.fxtwitter.com/${h}`);
      if (res.status === 404) return [h, null] as const;
      if (!res.ok) throw new Error(`Profile lookup failed for @${h} (${res.status})`);
      const body = (await res.json()) as { user?: { id: string; screen_name: string; name: string; avatar_url?: string } };
      const u = body.user;
      if (!u?.id || !/^\d+$/.test(u.id)) return [h, null] as const;
      return [h, { id: u.id, username: u.screen_name.toLowerCase(), name: u.name, image: u.avatar_url }] as const;
    })
  );
  return Object.fromEntries(results.filter(([, p]) => p !== null)) as Record<string, XProfile>;
}
