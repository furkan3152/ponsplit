// Serializable shapes shared by the chain reader and the browser.
import type { TokenMetadata } from "../metadata";
import type { Coin, Recipient } from "./reads";
export type CreatorRecipient = Recipient;
/** Compatibility type name for retained components; all recipients are TikTok creators. */
export type GithubRecipient = CreatorRecipient;
export type CoinView = Omit<Coin, "recipients"> & TokenMetadata & { recipients: CreatorRecipient[]; createdAt: number | null };
export type Earner = { handle: string; claimable: bigint; claimed: bigint; coins: number; verified: boolean; wallet?: string };
export type Snapshot = { at: number; coins: CoinView[]; earners: Earner[] };
