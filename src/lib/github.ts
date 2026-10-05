import "server-only";
import { isValidLogin, normalizeLogin } from "./github-handles";

/** A GitHub account as Splidev shows it. `id` is GitHub's permanent numeric id: pump.fun's fee account is keyed by it. */
export type GithubProfile = { id: string; login: string; name: string; avatar: string; type: "User" | "Organization" };

const TTL_MS = 10 * 60 * 1000;
const MISS_TTL_MS = 60 * 1000;
const MAX_CACHE = 10_000;
const byLogin = new Map<string, { at: number; profile: GithubProfile | null }>();
const byId = new Map<string, { at: number; profile: GithubProfile | null }>();

function get(m: Map<string, { at: number; profile: GithubProfile | null }>, k: string) {
  const hit = m.get(k);
  if (!hit) return undefined;
  if (Date.now() - hit.at > (hit.profile ? TTL_MS : MISS_TTL_MS)) {
    m.delete(k);
    return undefined;
  }
  return hit.profile;
}
function put(m: Map<string, { at: number; profile: GithubProfile | null }>, k: string, profile: GithubProfile | null) {
  m.delete(k);
  m.set(k, { at: Date.now(), profile });
  while (m.size > MAX_CACHE) m.delete(m.keys().next().value as string);
}
function remember(profile: GithubProfile | null, login?: string, id?: string) {
  if (profile) {
    put(byLogin, profile.login.toLowerCase(), profile);
    put(byId, profile.id, profile);
  } else {
    if (login) put(byLogin, login, null);
    if (id) put(byId, id, null);
  }
}

export class GithubBusyError extends Error {}

/**
 * GitHub's REST API. GITHUB_TOKEN (any token, no scopes needed) raises the limit from 60 to 5,000
 * lookups an hour; without one a busy site runs out quickly.
 */
async function api(path: string): Promise<GithubProfile | null> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "splidev", "x-github-api-version": "2022-11-28" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) throw new GithubBusyError("GitHub is rate-limiting lookups right now. Try again in a minute.");
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  const u = (await res.json()) as { id: number; login: string; name: string | null; avatar_url: string; type: string };
  return { id: String(u.id), login: u.login, name: u.name || u.login, avatar: u.avatar_url, type: u.type === "Organization" ? "Organization" : "User" };
}

/** Looks GitHub usernames up (cached). Missing accounts map to null. */
export async function resolveLogins(logins: string[]): Promise<Record<string, GithubProfile | null>> {
  const out: Record<string, GithubProfile | null> = {};
  await Promise.all(
    logins.map(async (raw) => {
      const login = normalizeLogin(raw);
      if (!isValidLogin(login)) {
        out[login] = null;
        return;
      }
      const hit = get(byLogin, login);
      if (hit !== undefined) {
        out[login] = hit;
        return;
      }
      const profile = await api(`/users/${encodeURIComponent(login)}`);
      remember(profile, login);
      out[login] = profile;
    })
  );
  return out;
}

/** Looks GitHub accounts up by numeric id (cached): the current username of a coin's recipient. */
export async function resolveIds(ids: string[]): Promise<Record<string, GithubProfile | null>> {
  const out: Record<string, GithubProfile | null> = {};
  await Promise.all(
    ids.map(async (id) => {
      if (!/^\d{1,20}$/.test(id)) {
        out[id] = null;
        return;
      }
      const hit = get(byId, id);
      if (hit !== undefined) {
        out[id] = hit;
        return;
      }
      const profile = await api(`/user/${id}`);
      remember(profile, undefined, id);
      out[id] = profile;
    })
  );
  return out;
}
