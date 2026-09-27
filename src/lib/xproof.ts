import "server-only";
import { createHmac, createHash } from "crypto";
import { getAddress, type Address } from "viem";
import { adminKey } from "./adminKey";
import { isValidHandle, normalizeHandle } from "./handles";
import { mockXId, resolverMode } from "./x";

/**
 * "Post to verify": proves control of an X account without an X developer app.
 *
 * The code is an HMAC over (username, wallet, UTC day) keyed by a secret derived from the signer
 * key, so it cannot be forged, only works for the wallet it was issued for, and expires after a
 * day or two. Anyone copying the post can at most send the fees to the poster's own wallet.
 */

const DAY = 86_400;

function secret(): Buffer {
  const key = adminKey();
  if (!key) throw new Error("Signer not configured");
  return createHash("sha256").update(`ponsplit-x-proof:${key}`).digest();
}

export function proofCode(handle: string, wallet: Address, day = Math.floor(Date.now() / 1000 / DAY)): string {
  const mac = createHmac("sha256", secret()).update(`${normalizeHandle(handle)}|${getAddress(wallet)}|${day}`).digest("hex");
  return `PS-${mac.slice(0, 10).toUpperCase()}`;
}

export function proofText(handle: string, wallet: Address): string {
  const w = getAddress(wallet);
  return `Claiming my coin fees on PonSplit 🪙\nwallet ${w.slice(0, 6)}…${w.slice(-4)}\nproof ${proofCode(handle, wallet)}`;
}

export type ProofResult = { id: string; username: string; name?: string; image?: string };

/** Status id from x.com / twitter.com / fxtwitter links. */
export function statusId(url: string): string | undefined {
  const m = url.trim().match(/(?:x|twitter|fxtwitter|vxtwitter|fixupx)\.com\/[^/]+\/status(?:es)?\/(\d{5,25})/i);
  return m?.[1];
}

/** Checks that `url` is a post by some account that contains a valid proof code for `wallet`. */
export async function verifyProofPost(url: string, wallet: Address): Promise<ProofResult> {
  if (resolverMode() === "mock") {
    // Local development: "mock:<username>" stands in for a real post.
    const handle = normalizeHandle(url.replace(/^mock:/, ""));
    if (!url.startsWith("mock:") || !isValidHandle(handle)) throw new Error("Use mock:<username> in mock mode.");
    return { id: mockXId(handle).toString(), username: handle, name: handle };
  }

  const id = statusId(url);
  if (!id) throw new Error("Paste the link to your post (x.com/…/status/…).");
  const res = await fetch(`https://api.fxtwitter.com/status/${id}`, { cache: "no-store" });
  if (res.status === 404) throw new Error("Post not found. Is it public and not deleted?");
  if (!res.ok) throw new Error(`Could not load the post (${res.status}). Try again in a minute.`);
  const body = (await res.json()) as {
    tweet?: { text?: string; author?: { id?: string; screen_name?: string; name?: string; avatar_url?: string } };
  };
  const text = body.tweet?.text ?? "";
  const author = body.tweet?.author;
  if (!author?.id || !/^\d+$/.test(author.id) || !author.screen_name) throw new Error("Could not read the post's author.");

  const username = author.screen_name.toLowerCase();
  const today = Math.floor(Date.now() / 1000 / DAY);
  const ok = [today, today - 1].some((d) => text.includes(proofCode(username, wallet, d)));
  if (!ok) throw new Error(`That post by @${username} doesn't contain a valid proof for this wallet. Post the exact text shown.`);
  return { id: author.id, username, name: author.name, image: author.avatar_url };
}
