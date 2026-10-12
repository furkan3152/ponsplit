// The shapes the server sends to the pages (src/lib/solana/server.ts builds them), kept free of
// server-only imports so client code can use them.
import type { TokenMetadata } from "../metadata";
import type { Coin, Recipient } from "./reads";

export type GithubRecipient = Recipient & { login?: string; name?: string; avatar?: string };
/** A coin with what the pages show around it: its metadata JSON, GitHub profiles and age. */
export type CoinView = Omit<Coin, "recipients"> & TokenMetadata & { recipients: GithubRecipient[]; createdAt: number | null };
/** A GitHub account's pump.fun earnings: waiting to be claimed and claimed so far (lamports). */
export type Earner = { githubId: string; login?: string; avatar?: string; claimable: bigint; claimed: bigint; coins: number };
export type Snapshot = { at: number; coins: CoinView[]; earners: Earner[] };
