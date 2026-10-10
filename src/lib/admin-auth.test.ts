import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ADMIN_WALLET } from "./admin-config";
import {
  ADMIN_CHALLENGE_SECONDS, ADMIN_SESSION_SECONDS,
  adminCookieOptions, adminSessionActive, assertAdminOrigin, consumeAdminChallenge,
  createAdminSession, decryptAdminCookie, encryptAdminCookie, getAdminAuthConfig,
  getAdminChallengeMessage, newAdminChallenge, revokeAdminSession, verifyAdminChallenge,
  type AdminAuthConfig,
} from "./admin-auth";

const secret = "test-only-admin-session-secret-with-32-bytes";
const env = { NODE_ENV: "development", SITE_URL: "https://admin.example", ADMIN_SESSION_SECRET: secret };
const pair = generateKeyPairSync("ed25519");
const wallet = new PublicKey(pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32));
const config = getAdminAuthConfig(env, wallet)!;
const signed = (message: string) => bs58.encode(sign(null, Buffer.from(message), pair.privateKey));

test("admin configuration fails closed without secrets, trusted origin, or production replay storage", () => {
  assert.equal(getAdminAuthConfig({ SITE_URL: "https://admin.example" }, wallet), null);
  assert.equal(getAdminAuthConfig({ ...env, ADMIN_SESSION_SECRET: "short" }, wallet), null);
  assert.equal(getAdminAuthConfig({ ...env, SITE_URL: "https://evil.example@admin.example" }, wallet), null);
  assert.equal(getAdminAuthConfig({ ...env, SITE_URL: "https://admin.example/path" }, wallet), null);
  assert.equal(getAdminAuthConfig({ ...env, SITE_URL: "https://admin.example?next=evil" }, wallet), null);
  assert.equal(getAdminAuthConfig({ ...env, SITE_URL: "http://admin.example" }, wallet), null);
  assert.equal(getAdminAuthConfig({ ...env, NODE_ENV: "production" }, wallet), null);
  assert.equal(getAdminAuthConfig({ ...env, NODE_ENV: "production", SITE_URL: "http://localhost:3000", ADMIN_REPLAY_REDIS_REST_URL: "https://redis.example", ADMIN_REPLAY_REDIS_REST_TOKEN: "test" }, wallet), null);
  assert.equal(getAdminAuthConfig(env, PublicKey.default), null);
  assert.ok(getAdminAuthConfig({ ...env, SITE_URL: "http://localhost:3000" }, wallet));
  assert.ok(getAdminAuthConfig({ ...env, ADMIN_SESSION_SECRET: undefined, TIKTOK_SESSION_SECRET: secret }, wallet));
  assert.ok(getAdminAuthConfig({ ...env, NODE_ENV: "production", ADMIN_REPLAY_REDIS_REST_URL: "https://redis.example", ADMIN_REPLAY_REDIS_REST_TOKEN: "test" }, wallet));
  assert.equal(getAdminAuthConfig({ ...env, ADMIN_REPLAY_REDIS_REST_URL: "http://redis.example", ADMIN_REPLAY_REDIS_REST_TOKEN: "test" }, wallet), null);
  assert.equal(getAdminAuthConfig({ ...env, ADMIN_REPLAY_REDIS_REST_URL: "https://redis.example" }, wallet), null);
  assert.equal(getAdminAuthConfig(env)?.wallet.toBase58(), ADMIN_WALLET.toBase58());
});

test("only the exact configured wallet can obtain a challenge", () => {
  const challenge = newAdminChallenge(wallet.toBase58(), config);
  assert.equal(challenge.wallet, wallet.toBase58());
  assert.equal(challenge.origin, config.origin);
  assert.equal(challenge.expiresAt - challenge.issuedAt, ADMIN_CHALLENGE_SECONDS * 1000);
  assert.notEqual(challenge.nonce, newAdminChallenge(wallet.toBase58(), config).nonce);
  for (const address of [Keypair.generate().publicKey.toBase58(), ` ${wallet.toBase58()}`, "", "invalid"]) {
    assert.throws(() => newAdminChallenge(address, config), { code: "admin_wallet_required" });
  }
});

test("AES-GCM admin cookies reject tampering, wrong secret, changed admin, origin, and expiry", () => {
  const now = Date.now();
  const challenge = newAdminChallenge(wallet.toBase58(), config, now);
  const cookie = encryptAdminCookie(challenge, secret);
  assert.deepEqual(decryptAdminCookie(cookie, config, now), challenge);
  const bytes = Buffer.from(cookie, "base64url");
  bytes[bytes.length - 1] ^= 1;
  assert.equal(decryptAdminCookie(bytes.toString("base64url"), config, now), null);
  assert.equal(decryptAdminCookie(cookie, { ...config, secret: "another-test-secret-with-at-least-32-bytes" }, now), null);
  assert.equal(decryptAdminCookie(cookie, { ...config, wallet: Keypair.generate().publicKey }, now), null);
  assert.equal(decryptAdminCookie(cookie, { ...config, origin: "https://other.example" }, now), null);
  assert.equal(decryptAdminCookie(cookie, config, challenge.expiresAt), null);
  assert.equal(decryptAdminCookie(cookie + "!", config, now), null);
  assert.equal(decryptAdminCookie(encryptAdminCookie({ ...challenge, expiresAt: now + 24 * 3600_000 }, secret), config, now), null);
});

test("signed admin proof is bound to nonce, origin, admin wallet, and timestamp", () => {
  const challenge = newAdminChallenge(wallet.toBase58(), config);
  const signature = signed(getAdminChallengeMessage(challenge));
  assert.doesNotThrow(() => verifyAdminChallenge(challenge, wallet.toBase58(), signature, config));
  assert.throws(() => verifyAdminChallenge(challenge, Keypair.generate().publicKey.toBase58(), signature, config), { code: "admin_wallet_required" });
  assert.throws(() => verifyAdminChallenge({ ...challenge, nonce: newAdminChallenge(wallet.toBase58(), config).nonce }, wallet.toBase58(), signature, config), { code: "invalid_signature" });
  assert.throws(() => verifyAdminChallenge({ ...challenge, issuedAt: challenge.issuedAt - 1 }, wallet.toBase58(), signature, config), { code: "challenge_expired" });
  const shifted = { ...challenge, issuedAt: challenge.issuedAt - 1, expiresAt: challenge.expiresAt - 1 };
  assert.throws(() => verifyAdminChallenge(shifted, wallet.toBase58(), signature, config), { code: "invalid_signature" });
  assert.throws(() => verifyAdminChallenge({ ...challenge, origin: "https://evil.example" }, wallet.toBase58(), signature, config), { code: "challenge_expired" });
  assert.throws(() => verifyAdminChallenge(challenge, wallet.toBase58(), signature, config, challenge.expiresAt), { code: "challenge_expired" });
  assert.throws(() => verifyAdminChallenge(challenge, wallet.toBase58(), "not-base58!", config), { code: "invalid_signature" });
});

test("admin mutation origin never trusts Host or forwarded headers", () => {
  assert.doesNotThrow(() => assertAdminOrigin(new Request(config.origin, { headers: { origin: config.origin } }), config));
  for (const origin of [undefined, "null", "https://evil.example", "https://admin.example.evil.example"]) {
    const req = new Request(config.origin, { headers: { ...(origin ? { origin } : {}), host: "admin.example", "x-forwarded-host": "admin.example" } });
    assert.throws(() => assertAdminOrigin(req, config), { code: "invalid_origin" });
  }
});

test("retaining a local challenge cookie cannot replay its proof, including concurrent requests", async () => {
  const challenge = newAdminChallenge(wallet.toBase58(), config);
  const results = await Promise.allSettled([consumeAdminChallenge(challenge, config), consumeAdminChallenge(challenge, config)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  await assert.rejects(() => consumeAdminChallenge(challenge, config), { code: "challenge_used" });
  await assert.rejects(() => consumeAdminChallenge(newAdminChallenge(wallet.toBase58(), config), { ...config, production: true }), { code: "admin_auth_unavailable" });
});

test("15-minute admin sessions require registry membership and logout revokes retained cookies", async () => {
  const challenge = newAdminChallenge(wallet.toBase58(), config);
  await consumeAdminChallenge(challenge, config);
  const session = await createAdminSession(challenge, config);
  assert.equal(session.expiresAt - session.issuedAt, ADMIN_SESSION_SECONDS * 1000);
  assert.equal(await adminSessionActive(session, config), true);
  assert.equal(await adminSessionActive({ ...session, sessionId: newAdminChallenge(wallet.toBase58(), config).nonce }, config), false);
  assert.equal(await adminSessionActive(session, config, session.expiresAt), false);
  const retained = decryptAdminCookie(encryptAdminCookie(session, secret), config);
  assert.ok(retained?.kind === "session");
  await revokeAdminSession(session, config);
  assert.equal(await adminSessionActive(retained, config), false);
});

test("shared Redis consumption is atomic and session revocation works across server configurations", async (t) => {
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  const sharedConfig: AdminAuthConfig = { ...config, production: true, replayStore: { url: "https://redis.example/", token: "test-redis-token" } };
  const records = new Map<string, string>();
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), sharedConfig.replayStore!.url);
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer test-redis-token");
    const command = JSON.parse(String(init?.body)) as (string | number)[];
    const record = String(command[1]);
    if (command[0] === "SET") {
      assert.ok(command.includes("NX"));
      assert.ok(command.includes("EX"));
      if (records.has(record)) return Response.json({ result: null });
      records.set(record, String(command[2]));
      return Response.json({ result: "OK" });
    }
    if (command[0] === "EXISTS") return Response.json({ result: records.has(record) ? 1 : 0 });
    if (command[0] === "DEL") return Response.json({ result: records.delete(record) ? 1 : 0 });
    throw new Error("Unexpected Redis command");
  };
  const challenge = newAdminChallenge(wallet.toBase58(), sharedConfig);
  const results = await Promise.allSettled([consumeAdminChallenge(challenge, sharedConfig), consumeAdminChallenge(challenge, { ...sharedConfig })]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const session = await createAdminSession(challenge, sharedConfig);
  assert.equal(await adminSessionActive(session, { ...sharedConfig }), true);
  await revokeAdminSession(session, sharedConfig);
  assert.equal(await adminSessionActive(session, { ...sharedConfig }), false);
  globalThis.fetch = async () => Response.json({ error: "store unavailable" });
  await assert.rejects(() => adminSessionActive(session, sharedConfig), { code: "admin_store_unavailable" });
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  await assert.rejects(() => consumeAdminChallenge(newAdminChallenge(wallet.toBase58(), sharedConfig), sharedConfig), { code: "admin_store_unavailable" });
});

test("admin cookies use Secure, HttpOnly, and SameSite Strict in production", (t) => {
  const original = process.env.NODE_ENV;
  t.after(() => { if (original === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original; });
  process.env.NODE_ENV = "production";
  assert.deepEqual(adminCookieOptions(900), { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 900 });
});
