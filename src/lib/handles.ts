/** X usernames: 1-15 characters, letters, digits and underscores. */
const HANDLE_RE = /^[a-z0-9_]{1,15}$/;

/** Accepts "@Name", "name", "x.com/name" or "https://twitter.com/name" and returns "name". */
export function normalizeHandle(input: string): string {
  let h = input.trim();
  h = h.replace(/^https?:\/\//i, "").replace(/^(www\.|mobile\.)?(x|twitter)\.com\//i, "");
  h = h.split(/[/?#]/)[0] ?? "";
  return h.replace(/^@+/, "").toLowerCase();
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle);
}

/** Avatar for a username without an API call; falls back to the generated sticker on error. */
export const xAvatarUrl = (handle: string) => `https://unavatar.io/x/${handle}?fallback=false`;

/** Opens the current profile for an account id, even after the account was renamed. */
export const xProfileUrlById = (id: bigint | string) => `https://x.com/i/user/${id.toString()}`;
