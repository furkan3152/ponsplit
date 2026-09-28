import "server-only";
import { createHmac, createHash } from "crypto";
import { getAddress, type Address } from "viem";
import { adminKey } from "./adminKey";
import { isValidHandle, normalizeHandle } from "./handles";
import { charge, remaining } from "./ratelimit";
import { fxFetch, mockXId, resolverMode } from "./x";

/**
 * "Post to verify": proves control of an X account without an X developer app.
 *
 * The account posts one exact sentence naming the full destination wallet plus a code. The code is
 * an HMAC over (username, wallet, UTC day) keyed by a secret derived from the signer key, so it
 * cannot be forged and expires after a day or two.
 *
 * Verification is deliberately strict: the whole post must be exactly that text (only trailing
 * links, e.g. an attached image, are ignored), and replies, quotes and reposts never count. A code
 * that merely appears somewhere in a post (in a link, a coin name, a bot's echo of a mention) is
 * rejected, so nobody can get an account to "prove" a wallet it didn't choose by posting it itself.
 */

const DAY = 86_400;
const PROOF_CHECKS_PER_MIN = 300;

function secret(): Buffer {
  const key = adminKey();
  if (!key) throw new Error("Signer not configured");
  return createHash("sha256").update(`ponsplit-x-proof:${key}`).digest();
}

export function proofCode(handle: string, wallet: Address, day = currentDay()): string {
  const mac = createHmac("sha256", secret()).update(`${normalizeHandle(handle)}|${getAddress(wallet)}|${day}`).digest("hex");
  return `PS-${mac.slice(0, 10).toUpperCase()}`;
}

export function proofText(handle: string, wallet: Address, day = currentDay()): string {
  return `Claiming my PonSplit coin fees to wallet ${getAddress(wallet)}\nproof ${proofCode(handle, wallet, day)}`;
}

function currentDay() {
  return Math.floor(Date.now() / 1000 / DAY);
}

/** Whitespace-insensitive form used to compare a post with the expected proof text. */
function canonical(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Drops links at the very end of a post (X appends one for attached media). */
function withoutTrailingLinks(s: string): string {
  return s.replace(/(\s+https?:\/\/\S+)+$/i, "");
}

export type ProofResult = { id: string; username: string; name?: string; image?: string };

/** Status id from x.com / twitter.com / fxtwitter links, including /i/web/status/<id>. */
export function statusId(url: string): string | undefined {
  const m = url
    .trim()
    .match(/(?:^|\/\/|\.)(?:x|twitter|fxtwitter|vxtwitter|fixupx|fixvx)\.com\/(?:[^/?#]+|i\/web)\/status(?:es)?\/(\d{5,25})/i);
  return m?.[1];
}

type FxStatus = {
  tweet?: {
    text?: string;
    raw_text?: { text?: string };
    author?: { id?: string; screen_name?: string; name?: string; avatar_url?: string };
    replying_to?: string | null;
    replying_to_status?: string | null;
    quote?: unknown;
    retweet?: unknown;
    reposted_by?: unknown;
  };
};

/**
 * Checks that `url` is a standalone post whose text is exactly the proof for `wallet`, and returns
 * its author. Accepts the codes for today and yesterday (UTC).
 */
export async function verifyProofPost(url: string, wallet: Address): Promise<ProofResult> {
  if (resolverMode() === "mock") {
    // Local development: "mock:<username>" stands in for a real post.
    const handle = normalizeHandle(url.replace(/^mock:/, ""));
    if (!url.startsWith("mock:") || !isValidHandle(handle)) throw new Error("Use mock:<username> in mock mode.");
    return { id: mockXId(handle).toString(), username: handle, name: handle };
  }

  const id = statusId(url);
  if (!id) throw new Error("Paste the link to your post (x.com/…/status/…).");
  // Proof checks have their own global budget, so resolver traffic can never starve claims and a
  // flood of claim attempts can't get the server throttled by the mirror.
  if (remaining("x-proof:*", PROOF_CHECKS_PER_MIN) === 0) throw new Error("Too many claims are being checked right now. Try again in a minute.");
  charge("x-proof:*", 1, 60_000);
  const res = await fxFetch(`https://api.fxtwitter.com/status/${id}`).catch(() => null);
  if (!res) throw new Error("Could not load the post. Try again in a minute.");
  if (res.status === 404) throw new Error("Post not found. Is it public and not deleted?");
  if (!res.ok) throw new Error(`Could not load the post (${res.status}). Try again in a minute.`);
  const body = (await res.json().catch(() => ({}))) as FxStatus;
  const tweet = body.tweet;
  const author = tweet?.author;
  if (!tweet || !author?.id || !/^\d+$/.test(author.id) || !author.screen_name) {
    throw new Error("Could not read the post's author.");
  }
  if (tweet.replying_to || tweet.replying_to_status) {
    throw new Error("That post is a reply. Post the proof as a new post, not a reply.");
  }
  if (tweet.quote || tweet.retweet || tweet.reposted_by) {
    throw new Error("That post quotes or reposts another post. Post the proof text on its own.");
  }

  const username = author.screen_name.toLowerCase();
  // fxtwitter gives the text twice: as posted (t.co links) and with links expanded. Either may match.
  const posted = [tweet.raw_text?.text, tweet.text]
    .filter((t): t is string => typeof t === "string")
    .map((t) => canonical(withoutTrailingLinks(t)));
  if (posted.some((t) => t.startsWith("RT @"))) throw new Error("Reposts don't count. Post the proof text yourself.");
  const today = currentDay();
  const expected = [today, today - 1].map((d) => canonical(proofText(username, wallet, d)));
  const ok = posted.some((t) => expected.includes(t));
  if (!ok) {
    throw new Error(
      `That post by @${username} isn't the proof for this wallet. Post the exact text shown, from @${username}, without changes.`
    );
  }
  return { id: author.id, username, name: author.name, image: author.avatar_url };
}
