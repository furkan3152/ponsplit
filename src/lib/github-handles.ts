/** GitHub usernames: 1-39 letters, digits or single hyphens, not starting or ending with one. */
const LOGIN_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;

/** Accepts "@name", "name", "github.com/name" or "https://github.com/name/repo" and returns "name". */
export function normalizeLogin(input: string): string {
  let h = input.trim();
  h = h.replace(/^https?:\/\//i, "").replace(/^(www\.)?github\.com\//i, "");
  h = h.split(/[/?#]/)[0] ?? "";
  return h.replace(/^@+/, "").toLowerCase();
}

export function isValidLogin(login: string): boolean {
  return LOGIN_RE.test(login);
}

/** Avatar by numeric id (stable across renames). */
export const githubAvatarById = (id: string | number, size = 96) => `https://avatars.githubusercontent.com/u/${id}?s=${size}&v=4`;
/** Profile by username. */
export const githubProfileUrl = (login: string) => `https://github.com/${login}`;
