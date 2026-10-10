import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import bs58 from "bs58";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  assertSameOrigin,
  buildTikTokAuthorizationUrl,
  decryptTikTokSession,
  encryptTikTokSession,
  equalOAuthState,
  exchangeTikTokCode,
  getAttestationConfig,
  getTikTokOAuthConfig,
  getVerificationMessage,
  newOAuthSession,
  publicTikTokSession,
  readTikTokSession,
  sessionCookieOptions,
  SESSION_LIFETIME_SECONDS,
  tiktokIdentityHash,
  validateAttestedTransaction,
  verifyWalletMessage,
  type TikTokSession,
} from "./tiktok-auth";

const secret = "test-only-session-secret-with-at-least-32-bytes";
const configured = {
  NODE_ENV: "production",
  TIKTOK_CLIENT_KEY: "test-client-key",
  TIKTOK_CLIENT_SECRET: "test-client-secret",
  TIKTOK_REDIRECT_URI: "https://creator.example/api/tiktok/callback",
  TIKTOK_SESSION_SECRET: secret,
};
const config = getTikTokOAuthConfig(configured)!;

function authenticated(now = Date.now()): TikTokSession {
  return {
    version: 1,
    kind: "authenticated",
    issuedAt: now,
    expiresAt: now + SESSION_LIFETIME_SECONDS * 1000,
    nonce: newOAuthSession().state,
    handle: "test.creator",
    openId: "test-open-id",
    displayName: "Test Creator",
    avatar: "https://cdn.example/avatar.png",
    accessToken: "test-access-token",
  };
}

test("OAuth configuration requires a trusted exact callback and strong cookie secret", () => {
  assert.equal(config.origin, "https://creator.example");
  assert.equal(getTikTokOAuthConfig({ ...configured, TIKTOK_SESSION_SECRET: "too-short" }), null);
  for (const redirect of ["http://creator.example/api/tiktok/callback", "https://creator.example/claim", "https://user:pass@creator.example/api/tiktok/callback", "https://creator.example/api/tiktok/callback?next=https://evil.example", "http://localhost/api/tiktok/callback"]) {
    assert.equal(getTikTokOAuthConfig({ ...configured, TIKTOK_REDIRECT_URI: redirect }), null, redirect);
  }
  assert.ok(getTikTokOAuthConfig({ ...configured, NODE_ENV: "development", TIKTOK_REDIRECT_URI: "http://localhost:3000/api/tiktok/callback" }));
  assert.equal(getAttestationConfig({ TIKTOK_ATTESTATION_URL: "http://signer.example", TIKTOK_ATTESTATION_TOKEN: "test" }), null);
  assert.equal(getAttestationConfig({ TIKTOK_ATTESTATION_URL: "https://signer.example", TIKTOK_ATTESTATION_TOKEN: "test" })?.url, "https://signer.example/");
});

test("OAuth has an unpredictable state and S256 PKCE with required official scopes", () => {
  const pending = newOAuthSession();
  const other = newOAuthSession();
  assert.notEqual(pending.state, other.state);
  assert.notEqual(pending.codeVerifier, other.codeVerifier);
  const url = new URL(buildTikTokAuthorizationUrl(config, pending));
  assert.equal(url.origin, "https://www.tiktok.com");
  assert.equal(url.searchParams.get("state"), pending.state);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(pending.codeVerifier).digest("base64url"));
  assert.equal(url.searchParams.get("scope"), "user.info.basic,user.info.profile");
  assert.ok(equalOAuthState(pending.state, pending.state));
  assert.ok(!equalOAuthState(other.state, pending.state));
  assert.ok(!equalOAuthState(null, pending.state));
  assert.ok(!equalOAuthState("x".repeat(129), pending.state));
});

test("encrypted sessions conceal account tokens and reject tampering, wrong keys, and expired cookies", () => {
  const now = Date.now();
  const session = authenticated(now);
  const value = encryptTikTokSession(session, secret);
  assert.ok(!value.includes(session.accessToken));
  assert.ok(!Buffer.from(value, "base64url").includes(Buffer.from(session.openId)));
  assert.deepEqual(decryptTikTokSession(value, secret, now), session);
  assert.equal(decryptTikTokSession(value, secret, session.expiresAt), null);
  assert.equal(decryptTikTokSession(value, "a-completely-different-secret-with-32-bytes", now), null);
  const bytes = Buffer.from(value, "base64url");
  bytes[bytes.length - 1] ^= 1;
  assert.equal(decryptTikTokSession(bytes.toString("base64url"), secret, now), null);
  assert.equal(decryptTikTokSession(`${value}!`, secret, now), null);
  assert.equal(decryptTikTokSession(encryptTikTokSession({ ...session, expiresAt: now + 24 * 3600_000 }, secret), secret, now), null);
  const req = new Request("https://creator.example/api/tiktok/status", { headers: { cookie: `unrelated=1; tiktok_session=${value}` } });
  assert.deepEqual(readTikTokSession(req, config), session);
  assert.deepEqual(publicTikTokSession(session), { handle: session.handle, displayName: session.displayName, avatar: session.avatar });
});

test("production session cookies are Secure, HttpOnly, host-scoped, and SameSite Lax", (t) => {
  const original = process.env.NODE_ENV;
  t.after(() => { if (original === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original; });
  process.env.NODE_ENV = "production";
  assert.deepEqual(sessionCookieOptions(1200), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 1200 });
});

test("verification messages bind the OAuth challenge, account, wallet, origin, and expiration", () => {
  const pair = generateKeyPairSync("ed25519");
  const publicBytes = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const wallet = new PublicKey(publicBytes);
  const session = authenticated();
  const message = getVerificationMessage(session, wallet.toBase58(), config.origin);
  const signature = bs58.encode(sign(null, Buffer.from(message), pair.privateKey));
  assert.ok(verifyWalletMessage(message, wallet, signature));
  assert.ok(!verifyWalletMessage(message + "\nchanged", wallet, signature));
  assert.ok(!verifyWalletMessage(getVerificationMessage({ ...session, nonce: newOAuthSession().state }, wallet.toBase58(), config.origin), wallet, signature));
  assert.ok(!verifyWalletMessage(getVerificationMessage(session, wallet.toBase58(), "https://other.example"), wallet, signature));
  assert.ok(!verifyWalletMessage(message, Keypair.generate().publicKey, signature));
  assert.ok(!verifyWalletMessage(message, wallet, "bad!"));
  assert.ok(!verifyWalletMessage(message, wallet, bs58.encode(new Uint8Array(63))));
  assert.deepEqual(Buffer.from(tiktokIdentityHash(session.openId)), createHash("sha256").update(`tiktok:${session.openId}`).digest());
});

test("mutations reject absent, cross-site, and null origins", () => {
  assert.doesNotThrow(() => assertSameOrigin(new Request(config.origin, { headers: { origin: config.origin } }), config));
  for (const origin of [null, "null", "https://evil.example", "https://creator.example.evil.example"]) {
    const req = new Request(config.origin, { headers: origin ? { origin } : {} });
    assert.throws(() => assertSameOrigin(req, config), { code: "invalid_origin" });
  }
});

test("attestation accepts only the verifier signature over the unchanged transaction", () => {
  const beneficiary = Keypair.generate();
  const verifier = Keypair.generate();
  const instruction = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [{ pubkey: verifier.publicKey, isSigner: true, isWritable: false }], data: Buffer.from([1]) });
  const original = new VersionedTransaction(new TransactionMessage({ payerKey: beneficiary.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [instruction] }).compileToV0Message());
  const returned = VersionedTransaction.deserialize(original.serialize());
  returned.sign([verifier]);
  const accepted = validateAttestedTransaction(original, returned.serialize(), verifier.publicKey);
  assert.deepEqual(accepted.message.serialize(), original.message.serialize());
  assert.ok(accepted.signatures[0].every((byte) => byte === 0));
  assert.throws(() => validateAttestedTransaction(original, original.serialize(), verifier.publicKey), { code: "invalid_attestation" });
  const changed = VersionedTransaction.deserialize(returned.serialize());
  changed.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
  changed.sign([verifier]);
  assert.throws(() => validateAttestedTransaction(original, changed.serialize(), verifier.publicKey), { code: "invalid_attestation" });
  const tooManySigners = VersionedTransaction.deserialize(returned.serialize());
  tooManySigners.sign([beneficiary]);
  assert.throws(() => validateAttestedTransaction(original, tooManySigners.serialize(), verifier.publicKey), { code: "invalid_attestation" });
  const invalid = VersionedTransaction.deserialize(returned.serialize());
  invalid.signatures[1][0] ^= 1;
  assert.throws(() => validateAttestedTransaction(original, invalid.serialize(), verifier.publicKey), { code: "invalid_attestation" });
});

test("official OAuth exchanges PKCE and rejects absent profile scope or inconsistent identity", async (t) => {
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  const pending = newOAuthSession();
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    if (String(input).endsWith("/oauth/token/")) {
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("code_verifier"), pending.codeVerifier);
      assert.equal(body.get("redirect_uri"), config.redirectUri);
      return Response.json({ access_token: "test-token", open_id: "test-account", scope: "user.info.basic,user.info.profile", expires_in: 86_400 });
    }
    assert.equal(new URL(String(input)).hostname, "open.tiktokapis.com");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer test-token");
    return Response.json({ error: { code: "ok" }, data: { user: { open_id: "test-account", username: "Test.Creator", display_name: "Test", avatar_url: "javascript:alert(1)" } } });
  };
  const session = await exchangeTikTokCode(config, pending, "test-code");
  assert.equal(calls, 2);
  assert.equal(session.handle, "test.creator");
  assert.equal(session.avatar, null);
  assert.equal(session.expiresAt - session.issuedAt, SESSION_LIFETIME_SECONDS * 1000);
  globalThis.fetch = async () => Response.json({ access_token: "test-token", open_id: "test-account", scope: "user.info.basic" });
  await assert.rejects(() => exchangeTikTokCode(config, pending, "test-code"), { code: "profile_scope_required" });
  globalThis.fetch = async (input) => String(input).endsWith("/oauth/token/")
    ? Response.json({ access_token: "test-token", open_id: "wrong-account", scope: "user.info.profile" })
    : Response.json({ error: { code: "ok" }, data: { user: { open_id: "test-account", username: "test.creator" } } });
  await assert.rejects(() => exchangeTikTokCode(config, pending, "test-code"), { code: "invalid_profile" });
});
