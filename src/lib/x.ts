import "server-only";
import { keccak256, toBytes } from "viem";
import { isValidHandle, normalizeHandle } from "./handles";

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
 * Upstream lookups for display (avatars and names while typing) share one global budget per
 * minute, so nobody can spend the server's quota and block launches. Launch attestations don't
 * count against it; they are limited per client IP instead.
 */
const DISPLAY_BUDGET_PER_MIN = 120;
let budget = { reset: 0, left: DISPLAY_BUDGET_PER_MIN };
function takeDisplayBudget(n: number): boolean {
  const now = Date.now();
  if (now > budget.reset) budget = { reset: now + 60_000, left: DISPLAY_BUDGET_PER_MIN };
  if (budget.left < n) return false;
  budget.left -= n;
  return true;
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
 * `purpose: "display"` is for previews: it draws from the shared budget (throws ResolverBusyError
 * when spent) and, in x-api mode, uses the free fxtwitter mirror so the X API quota is kept for
 * `purpose: "attest"`, the lookup a launch actually depends on.
 *
 * Modes:
 *  - x-api:     official X API v2 users lookup (needs X_BEARER_TOKEN; most reliable). Falls back
 *               to fxtwitter when X rate-limits us.
 *  - fxtwitter: the public api.fxtwitter.com mirror (no key; unofficial, best effort)
 *  - mock:      fake deterministic ids for local development only
 */
export async function resolveHandles(
  input: string[],
  purpose: "display" | "attest" = "attest"
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
  if (mode === "mock") [fresh, source] = [resolveMock(missing), "mock"];
  else if (purpose === "display") {
    if (!takeDisplayBudget(missing.length)) throw new ResolverBusyError();
    [fresh, source] = [await resolveFx(missing), "fx"];
  } else if (mode === "x-api") {
    try {
      [fresh, source] = [await resolveXApi(missing), "x"];
    } catch (e) {
      if (!(e instanceof XApiRateLimited)) throw e;
      [fresh, source] = [await resolveFx(missing), "fx"];
    }
  } else [fresh, source] = [await resolveFx(missing), "fx"];

  for (const h of missing) {
    out[h] = fresh[h] ?? null;
    remember(`${source}:${h}`, out[h]);
  }
  return out;
}

type Source = "x" | "fx" | "mock";

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
      const res = await fetch(`https://api.fxtwitter.com/${h}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
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
