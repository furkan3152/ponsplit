import { safeUrl } from "./metadata";
import type { Coin } from "./types";

/** The coin's picture from its metadata, when it's a link the site may render (https or ipfs). */
export const coinImage = (c: Pick<Coin, "image">) => safeUrl(c.image);

/** Where a coin trades, in a word or two. */
export const venueLabel = (c: Pick<Coin, "graduated">) => (c.graduated ? "pump.fun pool" : "bonding curve");

/** The short tag next to a coin's progress bar. */
export const progressTag = (c: Pick<Coin, "graduated">, pctText: string) => (c.graduated ? "graduated" : `${pctText}%`);

/** GitHub usernames of a coin's recipients (the id when GitHub didn't answer). */
export const recipientNames = (c: Pick<Coin, "recipients">) => c.recipients.map((r) => r.handle);

/** The coin on pump.fun's own site. */
export const pumpUrl = (mint: string) => `https://pump.fun/coin/${mint}`;
/** A Solana explorer link. */
export const explorerUrl = (kind: "tx" | "account" | "token", id: string) => `https://solscan.io/${kind}/${id}`;
