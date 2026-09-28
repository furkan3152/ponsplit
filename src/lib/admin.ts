import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { launcherAbi } from "./abi";
import { adminKey } from "./adminKey";
import { isLive, NETWORK_IDS, NETWORKS } from "./networks";
import { serverClient } from "./server-network";

/**
 * Who may open /setup: the wallets in ADMIN_ADDRESSES (comma-separated; public addresses, set on
 * the host) and the on-chain owner of each network's pinned launcher. They sign in by signing a
 * one-time message with that wallet; the site then keeps a signed, http-only session cookie.
 * Everyone else gets the sign-in screen and nothing of the setup page.
 */
export const ADMIN_COOKIE = "se-admin";
const SESSION_SECONDS = 12 * 3600;
const CHALLENGE_SECONDS = 10 * 60;

function secret(): Buffer | null {
  const key = adminKey();
  return key ? createHash("sha256").update(`splitearn-admin-session:${key}`).digest() : null;
}

const mac = (s: Buffer, data: string) => createHmac("sha256", s).update(data).digest("base64url");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** ADMIN_ADDRESSES, parsed; malformed entries are ignored. */
export function configuredAdmins(): Address[] {
  return (process.env.ADMIN_ADDRESSES ?? "")
    .split(/[\s,]+/)
    .filter((a) => isAddress(a, { strict: false }))
    .map((a) => getAddress(a));
}

let ownersCache: { at: number; owners: Address[] } | null = null;

/** The owners of the pinned launchers (cached for a minute). */
async function onchainOwners(): Promise<Address[]> {
  if (ownersCache && Date.now() - ownersCache.at < 60_000) return ownersCache.owners;
  const owners: Address[] = [];
  for (const id of NETWORK_IDS) {
    const n = NETWORKS[id];
    if (!isLive(n) || !n.launcher) continue;
    const owner = await serverClient(n)
      .readContract({ address: n.launcher, abi: launcherAbi, functionName: "owner" })
      .catch(() => null);
    if (owner) owners.push(getAddress(owner));
  }
  ownersCache = { at: Date.now(), owners };
  return owners;
}

export async function isAdminAddress(address: Address): Promise<boolean> {
  const a = getAddress(address);
  if (configuredAdmins().some((x) => x === a)) return true;
  return (await onchainOwners()).some((x) => x === a);
}

/** Whether anyone could sign in at all (else /setup says what to configure). */
export async function adminsConfigured(): Promise<boolean> {
  return configuredAdmins().length > 0 || (await onchainOwners()).length > 0;
}

/** The message a wallet signs to sign in; the nonce is self-authenticating, so nothing is stored. */
export function challengeFor(address: Address, host: string): { message: string } | null {
  const s = secret();
  if (!s) return null;
  const expires = Math.floor(Date.now() / 1000) + CHALLENGE_SECONDS;
  const salt = randomBytes(9).toString("base64url");
  const a = getAddress(address);
  const nonce = `${salt}.${expires}.${mac(s, `challenge|${a}|${host}|${salt}|${expires}`)}`;
  return {
    message: `Sign in to SplitEarn admin on ${host}\n\nWallet: ${a}\nNonce: ${nonce}\n\nThis only proves you own the wallet. It sends nothing and costs nothing.`,
  };
}

const MESSAGE = /^Sign in to SplitEarn admin on (\S+)\n\nWallet: (0x[0-9a-fA-F]{40})\nNonce: ([\w-]+)\.(\d+)\.([\w-]+)\n\nThis only proves you own the wallet\. It sends nothing and costs nothing\.$/;

/** The wallet a signed challenge came from, if the challenge is ours, for this host, and fresh. */
export function readChallenge(message: string, host: string): Address | null {
  const s = secret();
  const m = MESSAGE.exec(message);
  if (!s || !m) return null;
  const [, h, wallet, salt, expires, tag] = m;
  if (h !== host || Number(expires) < Date.now() / 1000) return null;
  const a = getAddress(wallet);
  return same(tag, mac(s, `challenge|${a}|${host}|${salt}|${expires}`)) ? a : null;
}

export function sessionValue(address: Address): string | null {
  const s = secret();
  if (!s) return null;
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const body = `${getAddress(address)}.${expires}`;
  return `${body}.${mac(s, `session|${body}`)}`;
}

export const sessionMaxAge = SESSION_SECONDS;

/** The signed-in admin, if the session cookie is valid and the wallet is still an admin. */
export async function currentAdmin(): Promise<Address | null> {
  const s = secret();
  const raw = cookies().get(ADMIN_COOKIE)?.value;
  if (!s || !raw) return null;
  const [address, expires, tag] = raw.split(".");
  if (!address || !expires || !tag || !isAddress(address) || Number(expires) < Date.now() / 1000) return null;
  if (!same(tag, mac(s, `session|${address}.${expires}`))) return null;
  const a = getAddress(address as Hex);
  return (await isAdminAddress(a)) ? a : null;
}
