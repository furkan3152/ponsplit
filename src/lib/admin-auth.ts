import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { ADMIN_WALLET } from "./admin-config";
import { verifyWalletMessage } from "./tiktok-auth";
import { clientIp, limitClient, rateLimit } from "./ratelimit";

export const ADMIN_CHALLENGE_COOKIE = "tiksplit_admin_challenge";
export const ADMIN_SESSION_COOKIE = "tiksplit_admin_session";
export const ADMIN_CHALLENGE_SECONDS = 5 * 60;
export const ADMIN_SESSION_SECONDS = 15 * 60;
export const ADMIN_NO_STORE = { "cache-control": "private, no-store", vary: "Cookie" };
const ADMIN_AAD = Buffer.from("tiksplit-admin-auth:v1");
const usedChallenges = new Map<string, number>();
const activeSessions = new Map<string, number>();
const MAX_LOCAL_RECORDS = 10_000;

export class AdminAuthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AdminAuthError";
    this.code = code;
    this.status = status;
  }
}

export type AdminAuthConfig = {
  origin: string;
  wallet: PublicKey;
  secret: string;
  production: boolean;
  replayStore: { url: string; token: string } | null;
};
type AdminCookieBase = { version: 1; origin: string; wallet: string; issuedAt: number; expiresAt: number };
export type AdminChallenge = AdminCookieBase & { kind: "challenge"; nonce: string };
export type AdminSession = AdminCookieBase & { kind: "session"; sessionId: string };
type AdminCookie = AdminChallenge | AdminSession;

export function getAdminAuthConfig(env: NodeJS.ProcessEnv = process.env, wallet: PublicKey | null = ADMIN_WALLET): AdminAuthConfig | null {
  const siteUrl = env.SITE_URL?.trim();
  const secret = env.ADMIN_SESSION_SECRET || env.TIKTOK_SESSION_SECRET;
  const production = env.NODE_ENV === "production";
  if (!siteUrl || !secret || Buffer.byteLength(secret) < 32 || !wallet || wallet.equals(PublicKey.default) || !PublicKey.isOnCurve(wallet.toBytes())) return null;
  try {
    const site = new URL(siteUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname);
    if (site.username || site.password || site.search || site.hash || site.pathname !== "/") return null;
    if (site.protocol !== "https:" && !(!production && local && site.protocol === "http:")) return null;
    let replayStore: AdminAuthConfig["replayStore"] = null;
    const storeUrl = env.ADMIN_REPLAY_REDIS_REST_URL?.trim();
    const storeToken = env.ADMIN_REPLAY_REDIS_REST_TOKEN?.trim();
    if (storeUrl || storeToken) {
      if (!storeUrl || !storeToken) return null;
      const parsed = new URL(storeUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.search) return null;
      replayStore = { url: parsed.toString(), token: storeToken };
    }
    // A process-local nonce cache cannot guarantee one-use proofs on multiple server instances.
    if (production && !replayStore) return null;
    return { origin: site.origin, wallet, secret, production, replayStore };
  } catch {
    return null;
  }
}

export function adminAuthReady(): boolean { return !!getAdminAuthConfig(); }

function requireAdminConfig(): AdminAuthConfig {
  const config = getAdminAuthConfig();
  if (!config) throw new AdminAuthError("admin_auth_unavailable", "Admin authentication is not configured securely.", 503);
  return config;
}

export function assertAdminOrigin(req: Request, config = requireAdminConfig()): void {
  if (req.headers.get("origin") !== config.origin) throw new AdminAuthError("invalid_origin", "Admin requests must come from this site's origin.", 403);
}

function assertAdminWallet(wallet: string, config: AdminAuthConfig): void {
  if (wallet.length > 64 || wallet !== config.wallet.toBase58()) throw new AdminAuthError("admin_wallet_required", "Connect the configured admin wallet.", 403);
}

export function newAdminChallenge(wallet: string, config = requireAdminConfig(), now = Date.now()): AdminChallenge {
  assertAdminWallet(wallet, config);
  return { version: 1, kind: "challenge", origin: config.origin, wallet, issuedAt: now, expiresAt: now + ADMIN_CHALLENGE_SECONDS * 1000, nonce: randomBytes(32).toString("base64url") };
}

export function getAdminChallengeMessage(challenge: AdminChallenge): string {
  return [
    "TikSplit admin sign-in",
    `Site: ${challenge.origin}`,
    `Admin wallet: ${challenge.wallet}`,
    `Challenge: ${challenge.nonce}`,
    `Issued at: ${new Date(challenge.issuedAt).toISOString()}`,
    `Expires at: ${new Date(challenge.expiresAt).toISOString()}`,
    "I authorize a 15-minute admin session on this site.",
    "This message does not transfer funds. Every on-chain action requires a separate wallet transaction signature.",
  ].join("\n");
}

function key(secret: string): Buffer {
  if (Buffer.byteLength(secret) < 32) throw new AdminAuthError("admin_auth_unavailable", "Admin authentication is not configured securely.", 503);
  return createHash("sha256").update(ADMIN_AAD).update(secret).digest();
}

export function encryptAdminCookie(cookie: AdminCookie, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(ADMIN_AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(cookie), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function decryptAdminCookie(value: string | undefined, config: AdminAuthConfig, now = Date.now()): AdminCookie | null {
  if (!value || value.length > 3000 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(config.secret), bytes.subarray(0, 12));
    decipher.setAAD(ADMIN_AAD);
    decipher.setAuthTag(bytes.subarray(12, 28));
    const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
    return validCookie(parsed, config, now) ? parsed : null;
  } catch { return null; }
}

function validCookie(value: unknown, config: AdminAuthConfig, now: number): value is AdminCookie {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  if (c.version !== 1 || c.origin !== config.origin || c.wallet !== config.wallet.toBase58()) return false;
  if (typeof c.issuedAt !== "number" || !Number.isFinite(c.issuedAt) || typeof c.expiresAt !== "number" || !Number.isFinite(c.expiresAt)) return false;
  const lifetime = c.kind === "challenge" ? ADMIN_CHALLENGE_SECONDS : ADMIN_SESSION_SECONDS;
  if (c.issuedAt > now + 30_000 || c.expiresAt <= now || c.expiresAt <= c.issuedAt || c.expiresAt - c.issuedAt > lifetime * 1000) return false;
  if (c.kind === "challenge") return typeof c.nonce === "string" && /^[A-Za-z0-9_-]{43}$/.test(c.nonce);
  return c.kind === "session" && typeof c.sessionId === "string" && /^[A-Za-z0-9_-]{43}$/.test(c.sessionId);
}

function cookieFromRequest(req: Request, name: string, config: AdminAuthConfig): AdminCookie | null {
  const cookie = req.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return decryptAdminCookie(cookie?.slice(name.length + 1), config);
}

export function adminCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge };
}

function storeKey(config: AdminAuthConfig, kind: "challenge" | "session", id: string): string {
  const namespace = createHash("sha256").update(`${config.origin}:${config.wallet.toBase58()}`).digest("hex").slice(0, 24);
  return `tiksplit:admin:${namespace}:${kind}:${id}`;
}

async function redisCommand(config: AdminAuthConfig, command: (string | number)[]): Promise<unknown> {
  if (!config.replayStore) throw new AdminAuthError("admin_auth_unavailable", "Admin authentication requires a shared replay store.", 503);
  try {
    const response = await fetch(config.replayStore.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.replayStore.token}` },
      body: JSON.stringify(command), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok || !response.body) throw new Error("Replay store unavailable");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); throw new Error("Replay store response too large"); }
      chunks.push(value);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { result?: unknown; error?: unknown };
    if (!result || result.error || !("result" in result)) throw new Error("Invalid replay store response");
    return result.result;
  } catch {
    throw new AdminAuthError("admin_store_unavailable", "Admin authentication storage is unavailable. Please try again.", 503);
  }
}

function pruneLocal(map: Map<string, number>, now: number): void {
  for (const [id, expiration] of map) if (expiration <= now) map.delete(id);
}

export function verifyAdminChallenge(challenge: AdminChallenge, wallet: string, signature: string, config: AdminAuthConfig, now = Date.now()): void {
  assertAdminWallet(wallet, config);
  if (!validCookie(challenge, config, now) || challenge.kind !== "challenge") throw new AdminAuthError("challenge_expired", "The admin challenge expired. Request a new one.", 401);
  if (signature.length > 128 || !verifyWalletMessage(getAdminChallengeMessage(challenge), config.wallet, signature)) throw new AdminAuthError("invalid_signature", "The admin wallet signature could not be verified.", 403);
}

/** Atomic SET NX is required in production: retained encrypted cookies cannot replay a proof. */
export async function consumeAdminChallenge(challenge: AdminChallenge, config: AdminAuthConfig, now = Date.now()): Promise<void> {
  if (!validCookie(challenge, config, now) || challenge.kind !== "challenge") throw new AdminAuthError("challenge_expired", "The admin challenge expired. Request a new one.", 401);
  const id = storeKey(config, "challenge", challenge.nonce);
  if (config.replayStore) {
    const result = await redisCommand(config, ["SET", id, "used", "NX", "EX", Math.max(1, Math.ceil((challenge.expiresAt - now) / 1000) + 30)]);
    if (result === null) throw new AdminAuthError("challenge_used", "This admin challenge was already used. Request a new one.", 409);
    if (result !== "OK") throw new AdminAuthError("admin_store_unavailable", "Admin authentication storage is unavailable. Please try again.", 503);
    return;
  }
  if (config.production) throw new AdminAuthError("admin_auth_unavailable", "Admin authentication requires a shared replay store.", 503);
  pruneLocal(usedChallenges, now);
  if (usedChallenges.has(id)) throw new AdminAuthError("challenge_used", "This admin challenge was already used. Request a new one.", 409);
  if (usedChallenges.size >= MAX_LOCAL_RECORDS) throw new AdminAuthError("admin_auth_busy", "Admin authentication is busy. Please try again later.", 503);
  usedChallenges.set(id, challenge.expiresAt + 30_000);
}

export async function createAdminSession(challenge: AdminChallenge, config: AdminAuthConfig, now = Date.now()): Promise<AdminSession> {
  if (!validCookie(challenge, config, now) || challenge.kind !== "challenge") throw new AdminAuthError("challenge_expired", "The admin challenge expired. Request a new one.", 401);
  const session: AdminSession = { version: 1, kind: "session", origin: config.origin, wallet: config.wallet.toBase58(), issuedAt: now, expiresAt: now + ADMIN_SESSION_SECONDS * 1000, sessionId: randomBytes(32).toString("base64url") };
  const id = storeKey(config, "session", session.sessionId);
  if (config.replayStore) {
    const result = await redisCommand(config, ["SET", id, "active", "NX", "EX", ADMIN_SESSION_SECONDS]);
    if (result !== "OK") throw new AdminAuthError("admin_store_unavailable", "Admin authentication storage is unavailable. Please try again.", 503);
  } else {
    if (config.production) throw new AdminAuthError("admin_auth_unavailable", "Admin authentication requires a shared replay store.", 503);
    pruneLocal(activeSessions, now);
    if (activeSessions.size >= MAX_LOCAL_RECORDS) throw new AdminAuthError("admin_auth_busy", "Admin authentication is busy. Please try again later.", 503);
    activeSessions.set(id, session.expiresAt);
  }
  return session;
}

export async function adminSessionActive(session: AdminSession, config: AdminAuthConfig, now = Date.now()): Promise<boolean> {
  if (!validCookie(session, config, now) || session.kind !== "session") return false;
  const id = storeKey(config, "session", session.sessionId);
  if (config.replayStore) return (await redisCommand(config, ["EXISTS", id])) === 1;
  if (config.production) throw new AdminAuthError("admin_auth_unavailable", "Admin authentication requires a shared replay store.", 503);
  const expiresAt = activeSessions.get(id);
  return expiresAt !== undefined && expiresAt > now;
}

export async function revokeAdminSession(session: AdminSession, config: AdminAuthConfig): Promise<void> {
  const id = storeKey(config, "session", session.sessionId);
  if (config.replayStore) {
    const result = await redisCommand(config, ["DEL", id]);
    if (result !== 0 && result !== 1) throw new AdminAuthError("admin_store_unavailable", "Admin authentication storage is unavailable. Please try again.", 503);
  } else {
    if (config.production) throw new AdminAuthError("admin_auth_unavailable", "Admin authentication requires a shared replay store.", 503);
    activeSessions.delete(id);
  }
}

export async function authenticateAdmin(req: Request, wallet: string, signature: string): Promise<AdminSession> {
  const config = requireAdminConfig();
  assertAdminOrigin(req, config);
  const challenge = cookieFromRequest(req, ADMIN_CHALLENGE_COOKIE, config);
  if (challenge?.kind !== "challenge") throw new AdminAuthError("challenge_required", "Request a fresh admin challenge before signing in.", 401);
  verifyAdminChallenge(challenge, wallet, signature, config);
  await consumeAdminChallenge(challenge, config);
  return createAdminSession(challenge, config);
}

export async function getAdminSession(req: Request): Promise<AdminSession | null> {
  const config = getAdminAuthConfig();
  if (!config) return null;
  const session = cookieFromRequest(req, ADMIN_SESSION_COOKIE, config);
  return session?.kind === "session" && await adminSessionActive(session, config) ? session : null;
}

export async function requireAdmin(req: Request): Promise<AdminSession> {
  requireAdminConfig();
  const session = await getAdminSession(req);
  if (!session) throw new AdminAuthError("admin_login_required", "Sign in with the configured admin wallet.", 401);
  return session;
}

export async function logoutAdmin(req: Request): Promise<void> {
  const config = requireAdminConfig();
  assertAdminOrigin(req, config);
  const session = cookieFromRequest(req, ADMIN_SESSION_COOKIE, config);
  if (session?.kind === "session") await revokeAdminSession(session, config);
}

export function adminRateLimit(req: Request, scope: string, budget: number): void {
  if (!limitClient(`admin-${scope}`, clientIp(req), budget) || !rateLimit(`admin-${scope}:*`, budget * 20, 60_000)) throw new AdminAuthError("rate_limited", "Too many admin requests. Please wait a minute.", 429);
}

export function adminErrorResponse(error: unknown): Response {
  return Response.json(error instanceof AdminAuthError ? { error: error.message, code: error.code } : { error: "Admin authentication could not be completed.", code: "admin_auth_failed" }, { status: error instanceof AdminAuthError ? error.status : 503, headers: ADMIN_NO_STORE });
}
