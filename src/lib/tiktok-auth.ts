import "server-only";
import { createCipheriv, createDecipheriv, createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import bs58 from "bs58";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

export const TIKTOK_COOKIE = "tiktok_session";
export const OAUTH_LIFETIME_SECONDS = 10 * 60;
export const SESSION_LIFETIME_SECONDS = 20 * 60;
const COOKIE_AAD = Buffer.from("tiktok-session:v1");
const PROFILE_ENDPOINT = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,username,display_name,avatar_url";

export class TikTokAuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "TikTokAuthError";
    this.code = code;
    this.status = status;
  }
}

export type TikTokOAuthConfig = { clientKey: string; clientSecret: string; redirectUri: string; origin: string; sessionSecret: string };
type SessionBase = { version: 1; issuedAt: number; expiresAt: number };
export type TikTokOAuthSession = SessionBase & { kind: "oauth"; state: string; codeVerifier: string };
export type TikTokSession = SessionBase & {
  kind: "authenticated";
  nonce: string;
  handle: string;
  openId: string;
  displayName: string;
  avatar: string | null;
  accessToken: string;
};
export type TikTokCookieSession = TikTokOAuthSession | TikTokSession;

/** The callback and mutation origin come from trusted configuration, never Host headers. */
export function getTikTokOAuthConfig(env: NodeJS.ProcessEnv = process.env): TikTokOAuthConfig | null {
  const clientKey = env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = env.TIKTOK_CLIENT_SECRET?.trim();
  const redirectUri = env.TIKTOK_REDIRECT_URI?.trim();
  const sessionSecret = env.TIKTOK_SESSION_SECRET;
  if (!clientKey || !clientSecret || !redirectUri || !sessionSecret || Buffer.byteLength(sessionSecret) < 32) return null;
  try {
    const url = new URL(redirectUri);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/api/tiktok/callback") return null;
    if (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && local && url.protocol === "http:")) return null;
    return { clientKey, clientSecret, redirectUri: url.toString(), origin: url.origin, sessionSecret };
  } catch {
    return null;
  }
}

export function requireTikTokOAuthConfig(): TikTokOAuthConfig {
  const config = getTikTokOAuthConfig();
  if (!config) throw new TikTokAuthError("oauth_unavailable", "TikTok Login Kit is not configured. Please try again after setup.", 503);
  return config;
}

export function getAttestationConfig(env: NodeJS.ProcessEnv = process.env): { url: string; token: string } | null {
  const url = env.TIKTOK_ATTESTATION_URL?.trim();
  const token = env.TIKTOK_ATTESTATION_TOKEN?.trim();
  if (!url || !token) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) return null;
    return { url: parsed.toString(), token };
  } catch {
    return null;
  }
}

export function assertSameOrigin(req: Request, config: Pick<TikTokOAuthConfig, "origin">): void {
  if (req.headers.get("origin") !== config.origin) {
    throw new TikTokAuthError("invalid_origin", "This request must come from this site's origin.", 403);
  }
}

export function newOAuthSession(now = Date.now()): TikTokOAuthSession {
  return { version: 1, kind: "oauth", state: randomBytes(32).toString("base64url"), codeVerifier: randomBytes(32).toString("base64url"), issuedAt: now, expiresAt: now + OAUTH_LIFETIME_SECONDS * 1000 };
}

export function buildTikTokAuthorizationUrl(config: TikTokOAuthConfig, session: TikTokOAuthSession): string {
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.search = new URLSearchParams({
    client_key: config.clientKey,
    scope: "user.info.basic,user.info.profile",
    response_type: "code",
    redirect_uri: config.redirectUri,
    state: session.state,
    code_challenge: createHash("sha256").update(session.codeVerifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export function equalOAuthState(actual: string | null, expected: string): boolean {
  if (!actual || actual.length > 128) return false;
  // Fixed-size hashes keep timingSafeEqual's inputs equal even for malformed state lengths.
  return timingSafeEqual(createHash("sha256").update(actual).digest(), createHash("sha256").update(expected).digest());
}

function sessionKey(secret: string): Buffer {
  if (Buffer.byteLength(secret) < 32) throw new Error("TIKTOK_SESSION_SECRET must contain at least 32 bytes.");
  return createHash("sha256").update(COOKIE_AAD).update(secret).digest();
}

export function encryptTikTokSession(session: TikTokCookieSession, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(secret), iv);
  cipher.setAAD(COOKIE_AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  const value = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  if (value.length > 3800) throw new TikTokAuthError("invalid_tiktok_response", "TikTok returned a profile that could not be stored securely.", 502);
  return value;
}

export function decryptTikTokSession(value: string | undefined, secret: string, now = Date.now()): TikTokCookieSession | null {
  if (!value || value.length > 7000 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", sessionKey(secret), bytes.subarray(0, 12));
    decipher.setAAD(COOKIE_AAD);
    decipher.setAuthTag(bytes.subarray(12, 28));
    const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    const session: unknown = JSON.parse(plaintext.toString("utf8"));
    return isSession(session, now) ? session : null;
  } catch {
    return null;
  }
}

function isSession(value: unknown, now: number): value is TikTokCookieSession {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  if (s.version !== 1 || typeof s.issuedAt !== "number" || typeof s.expiresAt !== "number" || !Number.isFinite(s.issuedAt) || !Number.isFinite(s.expiresAt)) return false;
  const maxAge = s.kind === "oauth" ? OAUTH_LIFETIME_SECONDS : SESSION_LIFETIME_SECONDS;
  if (s.issuedAt > now + 30_000 || s.expiresAt <= now || s.expiresAt <= s.issuedAt || s.expiresAt - s.issuedAt > maxAge * 1000) return false;
  if (s.kind === "oauth") return typeof s.state === "string" && /^[A-Za-z0-9_-]{43}$/.test(s.state) && typeof s.codeVerifier === "string" && /^[A-Za-z0-9_-]{43}$/.test(s.codeVerifier);
  if (s.kind !== "authenticated") return false;
  return typeof s.nonce === "string" && /^[A-Za-z0-9_-]{43}$/.test(s.nonce)
    && typeof s.handle === "string" && /^[a-z0-9_.]{1,24}$/.test(s.handle) && !s.handle.endsWith(".")
    && typeof s.openId === "string" && s.openId.length > 0 && s.openId.length <= 256
    && typeof s.displayName === "string" && s.displayName.length <= 128
    && (s.avatar === null || (typeof s.avatar === "string" && isHttpsUrl(s.avatar)))
    && typeof s.accessToken === "string" && s.accessToken.length > 0 && s.accessToken.length <= 2048;
}

export function readTikTokSession(req: Request, config: TikTokOAuthConfig): TikTokCookieSession | null {
  const cookie = req.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${TIKTOK_COOKIE}=`));
  return decryptTikTokSession(cookie?.slice(TIKTOK_COOKIE.length + 1), config.sessionSecret);
}

export function sessionCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}

export function publicTikTokSession(session: TikTokSession) {
  return { handle: session.handle, displayName: session.displayName, avatar: session.avatar };
}

export function getVerificationMessage(session: TikTokSession, wallet: string, origin = requireTikTokOAuthConfig().origin): string {
  const canonicalWallet = new PublicKey(wallet).toBase58();
  return [
    "TikTok creator fee wallet verification",
    `Site: ${origin}`,
    `TikTok: @${session.handle}`,
    `Wallet: ${canonicalWallet}`,
    `Challenge: ${session.nonce}`,
    `Issued at: ${new Date(session.issuedAt).toISOString()}`,
    `Expires at: ${new Date(session.expiresAt).toISOString()}`,
    "I authorize this wallet to receive creator fees for this TikTok account.",
    "This message does not transfer funds. The binding transaction requires a separate wallet signature.",
  ].join("\n");
}

export function verifyWalletMessage(message: string, wallet: PublicKey, signature: string): boolean {
  try {
    if (signature.length > 128 || !PublicKey.isOnCurve(wallet.toBytes())) return false;
    return verifyEd25519(Buffer.from(message, "utf8"), wallet, bs58.decode(signature));
  } catch {
    return false;
  }
}

export function verifyEd25519(message: Uint8Array, signer: PublicKey, signature: Uint8Array): boolean {
  if (signature.length !== 64) return false;
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), signer.toBuffer()]), format: "der", type: "spki" });
  return verify(null, message, key, signature);
}

/** A signing service can add only the configured verifier signature to our exact message. */
export function validateAttestedTransaction(original: VersionedTransaction, bytes: Uint8Array, verifier: PublicKey): VersionedTransaction {
  try {
    if (bytes.length > 1232) throw new Error("Transaction too large");
    const signed = VersionedTransaction.deserialize(bytes);
    const message = original.message.serialize();
    if (!Buffer.from(signed.message.serialize()).equals(Buffer.from(message))) throw new Error("Message changed");
    const verifierIndex = original.message.staticAccountKeys.slice(0, original.message.header.numRequiredSignatures).findIndex((key) => key.equals(verifier));
    if (verifierIndex < 0 || signed.signatures.length !== original.signatures.length) throw new Error("Verifier not required");
    signed.signatures.forEach((signature, index) => {
      if (index === verifierIndex) {
        if (!verifyEd25519(message, verifier, signature)) throw new Error("Invalid verifier signature");
      } else if (!Buffer.from(signature).equals(Buffer.from(original.signatures[index]))) {
        throw new Error("Unexpected signer changed");
      }
    });
    return signed;
  } catch {
    throw new TikTokAuthError("invalid_attestation", "The verification signer returned an invalid transaction. Please try again.", 502);
  }
}

export function tiktokIdentityHash(openId: string): Uint8Array {
  return createHash("sha256").update(`tiktok:${openId}`, "utf8").digest();
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return value.length <= 2048 && url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new TikTokAuthError("tiktok_unavailable", "TikTok could not be reached. Please try again.", 502);
  const reader = response.body?.getReader();
  if (!reader) throw new TikTokAuthError("invalid_tiktok_response", "TikTok returned an invalid response.", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32 * 1024) {
      await reader.cancel();
      throw new TikTokAuthError("invalid_tiktok_response", "TikTok returned an invalid response.", 502);
    }
    chunks.push(value);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new TikTokAuthError("invalid_tiktok_response", "TikTok returned an invalid response.", 502);
  }
}

export async function fetchTikTokProfile(accessToken: string): Promise<{ handle: string; openId: string; displayName: string; avatar: string | null }> {
  const response = await fetch(PROFILE_ENDPOINT, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
  const payload = await responseJson(response);
  const error = payload.error as { code?: string } | undefined;
  const data = payload.data as { user?: Record<string, unknown> } | undefined;
  const user = data?.user;
  if (error?.code !== "ok" || !user || typeof user.open_id !== "string" || !user.open_id || user.open_id.length > 256 || typeof user.username !== "string") {
    throw new TikTokAuthError("profile_scope_required", "TikTok must grant profile access, including the username. Please reconnect.", 403);
  }
  const handle = user.username.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_.]{1,24}$/.test(handle) || handle.endsWith(".")) throw new TikTokAuthError("invalid_profile", "TikTok returned an unsupported username.", 502);
  return { handle, openId: user.open_id, displayName: typeof user.display_name === "string" ? user.display_name.slice(0, 128) : handle, avatar: typeof user.avatar_url === "string" && isHttpsUrl(user.avatar_url) ? user.avatar_url : null };
}

export async function exchangeTikTokCode(config: TikTokOAuthConfig, pending: TikTokOAuthSession, code: string): Promise<TikTokSession> {
  if (!code || code.length > 2048) throw new TikTokAuthError("invalid_code", "TikTok did not provide a valid authorization code.");
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: config.clientKey, client_secret: config.clientSecret, code, grant_type: "authorization_code", redirect_uri: config.redirectUri, code_verifier: pending.codeVerifier }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const token = await responseJson(response);
  if (typeof token.access_token !== "string" || !token.access_token || token.access_token.length > 2048 || typeof token.scope !== "string" || !token.scope.split(",").map((s) => s.trim()).includes("user.info.profile")) {
    throw new TikTokAuthError("profile_scope_required", "TikTok profile permission is required to verify the username. Please reconnect.", 403);
  }
  const profile = await fetchTikTokProfile(token.access_token);
  if (typeof token.open_id !== "string" || token.open_id !== profile.openId) throw new TikTokAuthError("invalid_profile", "TikTok returned inconsistent account information.", 502);
  const now = Date.now();
  const tokenLifetime = typeof token.expires_in === "number" && Number.isFinite(token.expires_in) ? token.expires_in : SESSION_LIFETIME_SECONDS;
  const expiresAt = now + Math.min(SESSION_LIFETIME_SECONDS, tokenLifetime) * 1000;
  if (expiresAt <= now) throw new TikTokAuthError("expired_token", "TikTok access expired. Please reconnect.", 401);
  const session: TikTokSession = { version: 1, kind: "authenticated", nonce: randomBytes(32).toString("base64url"), issuedAt: now, expiresAt, ...profile, accessToken: token.access_token };
  // Avatar URLs are optional; keep the encrypted cookie within browser cookie limits.
  if (Buffer.byteLength(JSON.stringify(session)) > 2800) session.avatar = null;
  return session;
}
