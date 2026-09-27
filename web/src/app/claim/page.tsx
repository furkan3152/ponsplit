"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { useMemo, useState } from "react";
import type { Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { ClaimArt } from "@/components/art";
import { TokenAvatar } from "@/components/TokenAvatar";
import { XAvatar } from "@/components/XAvatar";
import { feeVaultAbi } from "@/lib/abi";
import { activeChain, explorerUrl } from "@/lib/chains";
import { FEE_VAULT_ADDRESS } from "@/lib/config";
import { errorMessage, formatEth, pct, shortAddress } from "@/lib/format";
import { isValidHandle, normalizeHandle } from "@/lib/handles";
import { useTokens, useXProfiles } from "@/lib/hooks";
import { describe } from "@/lib/market";
import { useServerConfig } from "@/lib/useServerConfig";

function useEarnings(xId: bigint | undefined) {
  return useReadContract({
    address: FEE_VAULT_ADDRESS,
    abi: feeVaultAbi,
    chainId: activeChain.id,
    functionName: "earningsOf",
    args: xId ? [[xId]] : undefined,
    query: { enabled: Boolean(xId && FEE_VAULT_ADDRESS), refetchInterval: 10_000 },
  });
}

export default function ClaimPage() {
  const { data: session, status } = useSession();
  const x = session?.x;

  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-4">
      <div className="flex items-center gap-5">
        <ClaimArt className="hidden h-28 w-36 shrink-0 sm:block" />
        <div>
          <h1 className="font-display text-[40px] font-bold tracking-[-0.03em]">Claim your fees</h1>
          <p className="mt-1 text-[15px] text-ink-2">Coins that list your X account send you part of every trade. Sign in with X to collect.</p>
        </div>
      </div>

      {status === "loading" ? <div className="card h-56 animate-pulse" /> : x ? <ClaimCard x={x} /> : <SignIn />}
      <Lookup />
    </div>
  );
}

function SignIn() {
  const server = useServerConfig();
  const [devName, setDevName] = useState("");
  return (
    <div className="card space-y-4 p-6 text-center">
      <p className="text-[15px] text-ink-2">Prove the account is yours. We only read your username and id.</p>
      <button className="btn-primary px-7 py-3 text-[16px]" disabled={server ? !server.xLogin : false} onClick={() => signIn("twitter")}>
        Sign in with X
      </button>
      {server && !server.xLogin ? <p className="text-[13px] text-down-ink">X login isn&apos;t configured on this server yet.</p> : null}
      {server?.devLogin ? (
        <form
          className="mx-auto flex max-w-sm gap-2 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            signIn("dev", { username: devName, redirect: false }).then(() => location.reload());
          }}
        >
          <input className="input !py-2" placeholder="dev: any username" value={devName} onChange={(e) => setDevName(e.target.value)} aria-label="Dev username" />
          <button className="btn-secondary shrink-0" type="submit">
            Dev login
          </button>
        </form>
      ) : null}
    </div>
  );
}

function ClaimCard({ x }: { x: { id: string; username: string; name?: string; image?: string } }) {
  const xId = BigInt(x.id);
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { writeContractAsync } = useWriteContract();
  const { data: earnings, refetch } = useEarnings(xId);
  const { data: tokens } = useTokens();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; tx?: string } | null>(null);

  const claimable = earnings?.[0][0];
  const earned = earnings?.[1][0];
  const streams = useMemo(
    () =>
      (tokens ?? [])
        .map((t) => ({ t, i: t.xIds.findIndex((id) => id === xId) }))
        .filter((s) => s.i >= 0)
        .map(({ t, i }) => ({ t, bps: t.bps[i], fromToken: (t.creatorFees * BigInt(t.bps[i])) / 10_000n })),
    [tokens, xId]
  );

  async function claim() {
    setMsg(null);
    if (!isConnected || !address) return openConnectModal?.();
    if (!FEE_VAULT_ADDRESS || !publicClient) return;
    try {
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      setBusy("Getting signature…");
      const res = await fetch("/api/claim-signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: address }),
      });
      const data = (await res.json()) as { error?: string; deadline: string; signature: Hex };
      if (!res.ok) throw new Error(data.error || "Could not get a claim signature");

      setBusy("Confirm in your wallet…");
      const hash = await writeContractAsync({
        address: FEE_VAULT_ADDRESS,
        abi: feeVaultAbi,
        chainId: activeChain.id,
        functionName: "claim",
        args: [xId, address, BigInt(data.deadline), data.signature],
      });
      setBusy("Claiming…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      setMsg({ kind: "ok", text: `Sent ${claimable ? formatEth(claimable, 6) : ""} ETH to your wallet.`, tx: hash });
      refetch();
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="card space-y-5 p-6">
        <div className="flex items-center gap-3">
          <XAvatar handle={x.username} image={x.image} size={48} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold">{x.name || x.username}</div>
            <div className="text-[13px] text-ink-2">@{x.username}</div>
          </div>
          <button className="text-[13px] font-medium text-ink-2 hover:text-ink" onClick={() => signOut({ redirect: false })}>
            Sign out
          </button>
        </div>

        <div className="rounded-3xl bg-card-2 p-5 text-center">
          <div className="text-[13px] font-medium text-ink-2">Ready to claim</div>
          <div className="num mt-1 font-display text-[44px] font-bold tracking-tight">{claimable !== undefined ? formatEth(claimable, 6) : "–"}</div>
          <div className="text-[13px] text-ink-2">ETH · {earned !== undefined ? `${formatEth(earned, 6)} earned all-time` : ""}</div>
        </div>

        <button className="btn-sticker w-full py-3.5 text-[16px]" disabled={Boolean(busy) || (isConnected && !claimable)} onClick={claim}>
          {!isConnected ? "Connect wallet to claim" : busy ?? (claimable ? `Claim to ${shortAddress(address!)}` : "Nothing to claim yet")}
        </button>
        {msg ? (
          <p role="status" className={`text-center text-[14px] font-medium ${msg.kind === "ok" ? "text-up-ink" : "text-down-ink"}`}>
            {msg.text}{" "}
            {msg.tx ? (
              <a className="underline" href={explorerUrl("tx", msg.tx)} target="_blank" rel="noreferrer">
                View transaction
              </a>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="card p-5">
        <h2 className="text-[17px] font-semibold">Your fee streams</h2>
        {streams.length === 0 ? (
          <p className="mt-2 text-[14px] text-ink-2">
            No coins list @{x.username} yet.{" "}
            <Link href="/create" className="font-medium text-ink underline">
              Launch one
            </Link>
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {streams.map(({ t, bps, fromToken }) => (
              <li key={t.token}>
                <Link href={`/token/${t.token}`} className="flex items-center gap-3 py-2.5">
                  <TokenAvatar src={describe(t).meta.image} seed={t.token} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">{t.name}</div>
                    <div className="text-[12px] text-ink-2">${t.symbol} · your share {pct(bps)}</div>
                  </div>
                  <span className="num text-[14px] font-semibold">{formatEth(fromToken, 5)} Ξ</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function Lookup() {
  const [input, setInput] = useState("");
  const handle = normalizeHandle(input);
  const valid = isValidHandle(handle);
  const profiles = useXProfiles(valid ? [handle] : []);
  const prof = valid ? profiles.data?.[handle] : undefined;
  const { data } = useEarnings(prof ? BigInt(prof.id) : undefined);

  return (
    <div className="card space-y-3 p-5">
      <label className="label" htmlFor="lookup">
        Check any X account
      </label>
      <input id="lookup" className="input" placeholder="@username" value={input} onChange={(e) => setInput(e.target.value)} />
      {valid && prof ? (
        <div className="flex items-center gap-3">
          <XAvatar handle={handle} image={prof.image} size={32} />
          <div className="flex-1 text-[14px]">
            <span className="font-semibold">@{handle}</span>
            <span className="text-ink-2"> · {data ? `${formatEth(data[0][0], 6)} ETH unclaimed · ${formatEth(data[1][0], 6)} earned` : "…"}</span>
          </div>
        </div>
      ) : valid && profiles.data && prof === null ? (
        <p className="text-[14px] text-ink-2">@{handle} doesn&apos;t exist on X.</p>
      ) : valid && profiles.error ? (
        <p className="text-[14px] text-ink-2">Lookup unavailable right now.</p>
      ) : null}
    </div>
  );
}
