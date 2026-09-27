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
const cache = new Map<string, { at: number; profile: XProfile | null }>();

/**
 * Resolves usernames to X accounts. Returns a map from normalized handle to profile, or null for
 * accounts that do not exist. Throws when the upstream lookup itself fails.
 *
 * Modes:
 *  - x-api:     official X API v2 users lookup (needs X_BEARER_TOKEN; most reliable)
 *  - fxtwitter: the public api.fxtwitter.com mirror (no key; unofficial, best effort)
 *  - mock:      fake deterministic ids for local development only
 */
export async function resolveHandles(input: string[]): Promise<Record<string, XProfile | null>> {
  const handles = Array.from(new Set(input.map(normalizeHandle))).filter(isValidHandle);
  const out: Record<string, XProfile | null> = {};
  const missing: string[] = [];
  for (const h of handles) {
    const hit = cache.get(h);
    if (hit && Date.now() - hit.at < TTL_MS) out[h] = hit.profile;
    else missing.push(h);
  }
  if (missing.length === 0) return out;

  const mode = resolverMode();
  const fresh =
    mode === "mock" ? resolveMock(missing) : mode === "x-api" ? await resolveXApi(missing) : await resolveFx(missing);
  for (const h of missing) {
    out[h] = fresh[h] ?? null;
    cache.set(h, { at: Date.now(), profile: out[h] });
  }
  return out;
}

function resolveMock(handles: string[]) {
  return Object.fromEntries(handles.map((h) => [h, { id: mockXId(h).toString(), username: h, name: h }]));
}

async function resolveXApi(handles: string[]) {
  const url = `https://api.x.com/2/users/by?usernames=${handles.join(",")}&user.fields=profile_image_url`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${process.env.X_BEARER_TOKEN}` }, cache: "no-store" });
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
      const res = await fetch(`https://api.fxtwitter.com/${h}`, { cache: "no-store" });
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
