import "server-only";
import { isValidLogin, normalizeLogin } from "./github-handles";

import type { GithubProfile } from "./github-types";
export type { GithubProfile };

// A numeric id never changes owner, so id lookups are kept for a day (misses too: an id that doesn't
// exist never will). Usernames can be renamed or registered, so they are kept shorter. Expired entries
// stay around as a fallback for when GitHub is rate-limiting us.
const ID_TTL_MS = 24 * 60 * 60 * 1000;
const LOGIN_TTL_MS = 60 * 60 * 1000;
const LOGIN_MISS_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 20_000;
type Entry = { at: number; profile: GithubProfile | null };
const byLogin = new Map<string, Entry>();
const byId = new Map<string, Entry>();

function get(m: Map<string, Entry>, k: string, stale = false) {
  const hit = m.get(k);
  if (!hit) return undefined;
  const ttl = m === byId ? ID_TTL_MS : hit.profile ? LOGIN_TTL_MS : LOGIN_MISS_TTL_MS;
  if (!stale && Date.now() - hit.at > ttl) return undefined;
  return hit.profile;
}
function put(m: Map<string, Entry>, k: string, profile: GithubProfile | null) {
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

/**
 * Site-wide budget of GitHub calls per hour and server instance, below GitHub's own limit (60 an hour
 * without a token, 5,000 with GITHUB_TOKEN), so no visitor or launched coin can drain it for everyone.
 */
// Usernames typed on /create and ids of coins' recipients have separate budgets, so a busy coin list
// can't starve the launch form (and the other way around).
const BUDGET = { login: [30, 3_000], id: [20, 1_000] } as const;
type Kind = keyof typeof BUDGET;
const spent: Record<Kind, { hour: number; n: number }> = { login: { hour: 0, n: 0 }, id: { hour: 0, n: 0 } };
function spend(kind: Kind): boolean {
  const hour = Math.floor(Date.now() / 3_600_000);
  if (spent[kind].hour !== hour) spent[kind] = { hour, n: 0 };
  if (spent[kind].n >= BUDGET[kind][process.env.GITHUB_TOKEN ? 1 : 0]) return false;
  spent[kind].n++;
  return true;
}

export class GithubBusyError extends Error {}

/**
 * GitHub's REST API. GITHUB_TOKEN (any token, no scopes needed) raises the limit from 60 to 5,000
 * lookups an hour; without one a busy site runs out quickly.
 */
async function api(path: string, kind: Kind): Promise<GithubProfile | null> {
  if (!spend(kind)) throw new GithubBusyError("GitHub lookups are busy right now. Try again in a few minutes.");
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
      try {
        const profile = await api(`/users/${encodeURIComponent(login)}`, "login");
        remember(profile, login);
        out[login] = profile;
      } catch (e) {
        const stale = get(byLogin, login, true);
        if (stale === undefined) throw e;
        out[login] = stale;
      }
    })
  );
  return out;
}

/**
 * Looks GitHub accounts up by numeric id (cached): the current username of a coin's recipient. Never
 * fails as a whole: an id GitHub can't answer right now keeps its last known profile, or is left out.
 */
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
      try {
        const profile = await api(`/user/${id}`, "id");
        remember(profile, undefined, id);
        out[id] = profile;
      } catch {
        const stale = get(byId, id, true);
        if (stale !== undefined) out[id] = stale;
      }
    })
  );
  return out;
}
