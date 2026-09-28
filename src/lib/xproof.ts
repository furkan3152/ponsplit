import "server-only";
import { createHmac, createHash } from "crypto";
import { getAddress, type Address } from "viem";
import { adminKey } from "./adminKey";
import { normalizeHandle } from "./handles";
import { limitClient } from "./ratelimit";
import { fxFetch } from "./x";

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
/** Upstream post fetches per client per minute (and 3x that per IPv6 /48). */
const PROOF_FETCHES_PER_MIN = 10;

function secret(): Buffer {
  const key = adminKey();
  if (!key) throw new Error("Signer not configured");
  return createHash("sha256").update(`ponsplit-x-proof:${key}`).digest();
}

export function proofCode(handle: string, wallet: Address, day = currentDay()): string {
  const mac = createHmac("sha256", secret()).update(`${normalizeHandle(handle)}|${getAddress(wallet)}|${day}`).digest("hex");
  return `PE-${mac.slice(0, 10).toUpperCase()}`;
}

export function proofText(handle: string, wallet: Address, day = currentDay()): string {
  return `Claiming my PonsEarn coin fees to wallet ${getAddress(wallet)}\nproof ${proofCode(handle, wallet, day)}`;
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

/** What a proof check needs from a post; texts are canonical, trailing links dropped. */
type Post = {
  author?: { id: string; username: string; name?: string; image?: string };
  reply: boolean;
  quoteOrRepost: boolean;
  texts: string[];
};

export class ProofBusyError extends Error {
  constructor() {
    super("Too many posts checked from your network. Try again in a minute.");
  }
}

/**
 * Fetched posts (and "not found") are remembered briefly per status id, so re-checking the same
 * post, or a flood of one junk id, costs no upstream request. Fetches that do go upstream count
 * against the client's own budget only: a shared counter would let a few clients block every claim.
 */
const POST_TTL_MS = 60_000;
const MISSING_TTL_MS = 15_000;
const MAX_POSTS = 2_000;
/** Longer posts can't be a proof; their text isn't kept. */
const MAX_PROOF_CHARS = 200;
const posts = new Map<string, { at: number; post: Post | null }>();
const inFlight = new Map<string, Promise<Post | null>>();

async function loadPost(id: string, client: string): Promise<Post | null> {
  const hit = posts.get(id);
  if (hit && Date.now() - hit.at < (hit.post ? POST_TTL_MS : MISSING_TTL_MS)) return hit.post;
  const pending = inFlight.get(id);
  if (pending) return pending;
  if (!limitClient("x-proof", client, PROOF_FETCHES_PER_MIN)) throw new ProofBusyError();
  const load = fetchPost(id).finally(() => inFlight.delete(id));
  inFlight.set(id, load);
  const post = await load;
  posts.delete(id); // re-insert so Map order stays oldest-first
  posts.set(id, { at: Date.now(), post });
  while (posts.size > MAX_POSTS) posts.delete(posts.keys().next().value as string);
  return post;
}

/** The post, or null when it doesn't exist. Throws on other failures (not cached). */
async function fetchPost(id: string): Promise<Post | null> {
  const res = await fxFetch(`https://api.fxtwitter.com/status/${id}`).catch(() => null);
  if (!res) throw new Error("Could not load the post. Try again in a minute.");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not load the post (${res.status}). Try again in a minute.`);
  const tweet = ((await res.json().catch(() => ({}))) as FxStatus).tweet;
  if (!tweet) throw new Error("Could not read the post.");
  const a = tweet.author;
  // fxtwitter gives the text twice: as posted (t.co links) and with links expanded. Either may match.
  const texts = [tweet.raw_text?.text, tweet.text]
    .filter((t): t is string => typeof t === "string")
    .map((t) => canonical(withoutTrailingLinks(t)));
  return {
    author: a?.id && /^\d+$/.test(a.id) && a.screen_name ? { id: a.id, username: a.screen_name.toLowerCase(), name: a.name, image: a.avatar_url } : undefined,
    reply: Boolean(tweet.replying_to || tweet.replying_to_status),
    quoteOrRepost: Boolean(tweet.quote || tweet.retweet || tweet.reposted_by) || texts.some((t) => t.startsWith("RT @")),
    texts: texts.map((t) => (t.length > MAX_PROOF_CHARS ? "" : t)),
  };
}

/**
 * Checks that `url` is a standalone post whose text is exactly the proof for `wallet`, and returns
 * its author. Accepts the codes for today and yesterday (UTC). `client` (the caller's IP key) pays
 * for upstream fetches; see loadPost.
 */
export async function verifyProofPost(url: string, wallet: Address, client: string): Promise<ProofResult> {
  const id = statusId(url);
  if (!id) throw new Error("Paste the link to your post (x.com/…/status/…).");
  const post = await loadPost(id, client);
  if (!post) throw new Error("Post not found. Is it public and not deleted?");
  const author = post.author;
  if (!author) throw new Error("Could not read the post's author.");
  if (post.reply) throw new Error("That post is a reply. Post the proof as a new post, not a reply.");
  if (post.quoteOrRepost) throw new Error("That post quotes or reposts another post. Post the proof text on its own.");

  const username = author.username;
  const today = currentDay();
  const expected = [today, today - 1].map((d) => canonical(proofText(username, wallet, d)));
  if (!post.texts.some((t) => expected.includes(t))) {
    throw new Error(
      `That post by @${username} isn't the proof for this wallet. Post the exact text shown, from @${username}, without changes.`
    );
  }
  return { id: author.id, username, name: author.name, image: author.image };
}
