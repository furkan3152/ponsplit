import "server-only";
import { keccak256, toBytes } from "viem";
import { isValidHandle, normalizeHandle } from "./handles";
import { networkKey } from "./ip";
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
/**
 * "Doesn't exist" is remembered only briefly: the username can be registered at any moment, and
 * the mirror occasionally answers 404 for accounts that do exist.
 */
const MISS_TTL_MS = 60 * 1000;
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
 * and launch attestations ("attest"), per client (IP; IPv6 per /64) and per wider network (IPv6
 * /48, since one holder of a /48 controls 65,536 /64s). Lookups that find no account cost more
 * (spraying random names is the cheap way to burn a budget; real launches name real accounts), and
 * a client that keeps missing is cut off for the minute. Budgets are checked before anything is
 * charged, so a refused request costs nothing. Cached answers never cost anything.
 *
 * There is deliberately no global cap on launches: any shared counter is a switch anyone with a
 * few dozen addresses could flip to stop every launch. Previews have a global cap (they are
 * optional), but past it every client still gets a small fair share, so previews can't be blanked
 * for everyone either. In x-api mode the X API calls themselves are capped globally (they may cost
 * money); past that cap, or when X rate-limits us, launches resolve through fxtwitter instead.
 */
const LIMITS = {
  display: { client: 20, global: 120, fairShare: 4, misses: 20 },
  attest: { client: 30, misses: 10 },
} as const;
/** How much more a whole IPv6 /48 may look up than one of its clients. */
const NETWORK_FACTOR = 3;
const MISS_WEIGHT = 3;
const WINDOW_MS = 60_000;
/** X API calls per minute for launches; one call resolves a whole launch. */
const X_API_CALLS_PER_MIN = 60;
const X_API_KEY = "x-api-calls:*";
const DISPLAY_GLOBAL_KEY = "x-lookups:display:*";

type Purpose = "display" | "attest";

/** How many of `n` lookups the budgets allow this client right now (0..n). Charges nothing. */
function available(purpose: Purpose, client: string, n: number): number {
  const l = LIMITS[purpose];
  if (remaining(`x-misses:${purpose}:${client}`, l.misses) === 0) return 0;
  const clientLeft = remaining(`x-lookups:${purpose}:${client}`, l.client);
  const net = networkKey(client);
  const netLeft = net === client ? Infinity : remaining(`x-lookups:${purpose}:${net}`, l.client * NETWORK_FACTOR);
  let globalLeft = Infinity;
  if (purpose === "display") {
    const d = LIMITS.display;
    const used = d.client - clientLeft;
    globalLeft = Math.max(remaining(DISPLAY_GLOBAL_KEY, d.global), d.fairShare - used);
  }
  return Math.max(0, Math.min(n, clientLeft, netLeft, globalLeft));
}

function spend(purpose: Purpose, client: string, units: number) {
  charge(`x-lookups:${purpose}:${client}`, units, WINDOW_MS);
  const net = networkKey(client);
  if (net !== client) charge(`x-lookups:${purpose}:${net}`, units, WINDOW_MS);
  if (purpose === "display") charge(DISPLAY_GLOBAL_KEY, units, WINDOW_MS);
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
 * its client's budget throws ResolverBusyError. A preview returns what fits (handles left out are
 * simply absent from the result) and throws ResolverBusyError only when it can return nothing.
 * `purpose: "display"` is for previews: they use the free fxtwitter mirror so the X API quota is
 * kept for `purpose: "attest"`, the lookup a launch actually depends on.
 *
 * Modes:
 *  - x-api:     official X API v2 users lookup (needs X_BEARER_TOKEN; most reliable). Falls back
 *               to fxtwitter when X rate-limits us or our own X API cap is reached.
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
  // In x-api mode a launch asks X itself while the X API cap has room.
  const useXApi = mode === "x-api" && purpose === "attest" && remaining(X_API_KEY, X_API_CALLS_PER_MIN) > 0;
  // Results are cached per source. A launch that asks X only trusts X API answers; everything
  // else may reuse either (an fxtwitter answer is what it would get anyway).
  const readable: Source[] = mode === "mock" ? ["mock"] : useXApi ? ["x"] : ["x", "fx"];
  const out: Record<string, XProfile | null> = {};
  const missing: string[] = [];
  for (const h of handles) {
    const hit = readable.map((src) => cached(`${src}:${h}`)).find((p) => p !== undefined);
    // A launch looks "doesn't exist" up again rather than failing on a remembered miss.
    if (hit !== undefined && !(hit === null && purpose === "attest")) out[h] = hit;
    else missing.push(h);
  }
  if (missing.length === 0) return out;

  let fresh: Record<string, XProfile>;
  let source: Source;
  if (mode === "mock") {
    [fresh, source] = [resolveMock(missing), "mock"];
  } else {
    const allowed = available(purpose, client, missing.length);
    // A launch needs every account resolved; a preview shows what fits and leaves the rest unknown.
    if (purpose === "attest" && allowed < missing.length) throw new ResolverBusyError();
    if (allowed === 0) {
      if (Object.keys(out).length === 0) throw new ResolverBusyError();
      return out;
    }
    missing.splice(allowed);
    spend(purpose, client, allowed);
    if (useXApi) {
      charge(X_API_KEY, 1, WINDOW_MS);
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
    // Misses also weigh more against the lookup budgets.
    spend(purpose, client, misses * (MISS_WEIGHT - 1));
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

/** Mirror lookups in progress: requests for the same account at the same moment share one. */
const fxInFlight = new Map<string, Promise<XProfile | null>>();

async function resolveFx(handles: string[]) {
  const results = await Promise.all(
    handles.map(async (h) => {
      let lookup = fxInFlight.get(h);
      if (!lookup) {
        lookup = fxProfile(h).finally(() => fxInFlight.delete(h));
        fxInFlight.set(h, lookup);
      }
      return [h, await lookup] as const;
    })
  );
  return Object.fromEntries(results.filter(([, p]) => p !== null)) as Record<string, XProfile>;
}

/**
 * One username through the mirror, or null when it doesn't exist. The mirror sometimes answers 404
 * for an account that exists (when its own upstream call fails), and may cache that answer for a
 * little while, so a 404 is confirmed once through its other endpoint before it counts.
 */
async function fxProfile(h: string): Promise<XProfile | null> {
  const first = await fxUser(`https://api.fxtwitter.com/${h}`, h);
  if (first !== null) return first;
  await new Promise((r) => setTimeout(r, 300));
  return fxUser(`https://api.fxtwitter.com/2/profile/${h}`, h);
}

async function fxUser(url: string, h: string): Promise<XProfile | null> {
  const res = await fxFetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Profile lookup failed for @${h} (${res.status})`);
  const body = (await res.json().catch(() => ({}))) as { user?: { id?: string; screen_name?: string; name?: string; avatar_url?: string } };
  const u = body.user;
  if (!u?.id || !/^\d+$/.test(u.id) || !u.screen_name) return null;
  // The mirror links the 48 px avatar; ask for the same larger size the X API path uses.
  return { id: u.id, username: u.screen_name.toLowerCase(), name: u.name ?? u.screen_name, image: u.avatar_url?.replace("_normal.", "_200x200.") };
}
