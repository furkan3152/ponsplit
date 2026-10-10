"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { GithubProfile } from "./github-types";
import { isValidLogin, normalizeLogin } from "./github-handles";
import { creatorVaultClaimable } from "./solana/tiktok-escrow";
import { isValidTikTokHandle, normalizeTikTokHandle, isTikTokLaunchReady } from "./tiktok-config";
import type { Coin, Snapshot, Trade } from "./types";
import { decode } from "./wire";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    let msg = `The server answered ${res.status}.`;
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? msg;
    } catch {
      // not JSON
    }
    throw new Error(msg);
  }
  return decode<T>(text);
}

/** Every Splitdev coin and the GitHub accounts they pay, as one shared server read (refreshed every 10 s). */
export function useSnapshot() {
  return useQuery({ queryKey: ["snapshot"], queryFn: () => getJson<Snapshot>("/api/snapshot"), refetchInterval: 10_000, retry: 2 });
}

export function useCoins() {
  const q = useSnapshot();
  return { ...q, data: q.data?.coins };
}

/** One coin (null when the mint isn't a Splitdev coin). */
export function useCoin(mint: string | undefined) {
  return useQuery({
    queryKey: ["coin", mint],
    enabled: Boolean(mint),
    refetchInterval: 6_000,
    queryFn: async () => {
      const r = await getJson<{ coin: Coin | null }>(`/api/coin?mint=${mint}`);
      return r.coin;
    },
  });
}

/** A coin's latest trades, newest first. */
export function useCoinTrades(coin: Coin | null | undefined) {
  return useQuery({
    queryKey: ["trades", coin?.token, coin?.graduated],
    enabled: Boolean(coin),
    refetchInterval: 6_000,
    queryFn: async () => (await getJson<{ trades: Trade[] }>(`/api/trades?mint=${coin!.token}&graduated=${coin!.graduated ? 1 : 0}`)).trades,
  });
}

/** GitHub profiles for usernames, looked up by the server (null: no such account). */
export function useGithubProfiles(logins: string[]) {
  const clean = Array.from(new Set(logins.map(normalizeLogin).filter(isValidLogin))).sort();
  return useQuery({
    queryKey: ["github", clean.join(",")],
    enabled: clean.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => (await getJson<{ profiles: Record<string, GithubProfile | null> }>(`/api/github/resolve?logins=${clean.join(",")}`)).profiles,
  });
}

/** A TikTok handle's escrow balance. No pump.fun social-platform id is invented. */
export function useClaimable(handle: string | undefined) {
  const { connection } = useConnection();
  const clean = normalizeTikTokHandle(handle ?? "");
  return useQuery({
    queryKey: ["tiktok-claimable", clean],
    enabled: isTikTokLaunchReady() && isValidTikTokHandle(clean),
    refetchInterval: 15_000,
    queryFn: () => creatorVaultClaimable(connection, clean),
  });
}
/** The connected wallet's SOL (lamports). */
export function useSolBalance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  return useQuery({
    queryKey: ["sol", publicKey?.toBase58()],
    enabled: Boolean(publicKey),
    refetchInterval: 10_000,
    queryFn: async () => BigInt(await connection.getBalance(publicKey!, "confirmed")),
  });
}

/** The connected wallet's balance of a pump.fun coin (raw, 6 decimals). */
export function useTokenBalance(mint: string | undefined) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  return useQuery({
    queryKey: ["tokens", mint, publicKey?.toBase58()],
    enabled: Boolean(publicKey && mint),
    refetchInterval: 10_000,
    queryFn: async () => {
      const ata = getAssociatedTokenAddressSync(new PublicKey(mint!), publicKey!, false, TOKEN_2022_PROGRAM_ID);
      const r = await connection.getTokenAccountBalance(ata, "confirmed").catch(() => null);
      return BigInt(r?.value.amount ?? "0");
    },
  });
}

/** The Splitdev coins a wallet holds (raw balances, 6 decimals). */
export function useHoldings(owner: string | undefined) {
  const { connection } = useConnection();
  const { data: coins } = useCoins();
  const q = useQuery({
    queryKey: ["holdings", owner],
    enabled: Boolean(owner),
    refetchInterval: 20_000,
    queryFn: async () => {
      const r = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner!), { programId: TOKEN_2022_PROGRAM_ID }, "confirmed");
      const out = new Map<string, bigint>();
      for (const a of r.value) {
        const info = (a.account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } }).parsed?.info;
        if (info?.mint && info.tokenAmount?.amount && info.tokenAmount.amount !== "0") out.set(info.mint, (out.get(info.mint) ?? 0n) + BigInt(info.tokenAmount.amount));
      }
      return out;
    },
  });
  const holdings = (coins ?? []).flatMap((coin) => {
    const balance = q.data?.get(coin.token);
    return balance ? [{ coin, balance }] : [];
  });
  return { holdings, isLoading: q.isLoading, error: q.error };
}

// ------------------------------------------------------------------ small utilities

/** The value, once it has stopped changing for `ms` (use primitives: arrays are new every render). */
export function useDebounced<T>(value: T, ms = 450) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Re-renders every `ms` so relative times stay fresh. */
export function useNow(ms = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
