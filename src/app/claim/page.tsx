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
import { useClaimsPaused, useTokens, useXProfiles } from "@/lib/hooks";
import { describe } from "@/lib/market";
import { useServerConfig } from "@/lib/useServerConfig";

type Msg = { kind: "ok" | "err"; text: string; tx?: string } | null;
type SigResponse = { error?: string; xId: string; username: string; deadline: string; signature: Hex; claimable: string };

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

/** Asks the server for a claim signature, then sends the claim transaction. */
function useClaim(onDone: () => void) {
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  async function claim(extra: { proofUrl?: string } = {}) {
    setMsg(null);
    if (!isConnected || !address) return openConnectModal?.();
    if (!FEE_VAULT_ADDRESS || !publicClient) return;
    try {
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      setBusy(extra.proofUrl ? "Checking your post…" : "Getting signature…");
      const res = await fetch("/api/claim-signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: address, ...extra }),
      });
      const data = (await res.json()) as SigResponse;
      if (!res.ok) throw new Error(data.error || "Could not get a claim signature");

      setBusy("Confirm in your wallet…");
      const hash = await writeContractAsync({
        address: FEE_VAULT_ADDRESS,
        abi: feeVaultAbi,
        chainId: activeChain.id,
        functionName: "claim",
        args: [BigInt(data.xId), address, BigInt(data.deadline), data.signature],
      });
      setBusy("Claiming…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      setMsg({ kind: "ok", text: `Sent ${formatEth(BigInt(data.claimable), 6)} ETH to your wallet.`, tx: hash });
      onDone();
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }
  return { claim, busy, msg, address, isConnected };
}

export default function ClaimPage() {
  const { data: session, status } = useSession();
  const x = session?.x;
  const paused = useClaimsPaused();

  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-4">
      <div className="flex items-center gap-5">
        <ClaimArt className="hidden h-28 w-36 shrink-0 sm:block" />
        <div>
          <h1 className="font-display text-[40px] font-bold tracking-[-0.03em]">Claim your fees</h1>
          <p className="mt-1 text-[15px] text-ink-2">Coins that list your X account send you part of every trade. Prove the account is yours and collect.</p>
        </div>
      </div>

      {paused ? (
        <p className="card p-4 text-[14px] font-medium text-down-ink">
          Claims are paused by the owner for maintenance. Your balance is safe in the vault and can be claimed once they resume.
        </p>
      ) : null}
      {status === "loading" ? <div className="card h-56 animate-pulse" /> : x ? <SessionClaim x={x} /> : <ProofClaim />}
      <Lookup />
    </div>
  );
}

function Balance({ xId }: { xId: bigint | undefined }) {
  const { data } = useEarnings(xId);
  return (
    <div className="rounded-3xl bg-card-2 p-5 text-center">
      <div className="text-[13px] font-medium text-ink-2">Ready to claim</div>
      <div className="num mt-1 font-display text-[44px] font-bold tracking-tight">{data ? formatEth(data[0][0], 6) : "–"}</div>
      <div className="text-[13px] text-ink-2">ETH{data ? ` · ${formatEth(data[1][0], 6)} earned all-time` : ""}</div>
    </div>
  );
}

function Result({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p role="status" className={`text-center text-[14px] font-medium ${msg.kind === "ok" ? "text-up-ink" : "text-down-ink"}`}>
      {msg.text}{" "}
      {msg.tx ? (
        <a className="underline" href={explorerUrl("tx", msg.tx)} target="_blank" rel="noreferrer">
          View transaction
        </a>
      ) : null}
    </p>
  );
}

/** Default flow: prove the account by posting a one-time code. Needs no X developer app. */
function ProofClaim() {
  const server = useServerConfig();
  const [input, setInput] = useState("");
  const [proof, setProof] = useState<{ text: string; intentUrl: string; for: string } | null>(null);
  const [postUrl, setPostUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const handle = normalizeHandle(input);
  const valid = isValidHandle(handle);
  const profiles = useXProfiles(valid ? [handle] : []);
  const prof = valid ? profiles.data?.[handle] : undefined;
  const xId = prof ? BigInt(prof.id) : undefined;
  const earnings = useEarnings(xId);
  const { claim, busy, msg, address, isConnected } = useClaim(() => earnings.refetch());
  const { openConnectModal } = useConnectModal();
  const proofKey = `${handle}|${address}`;
  const currentProof = proof?.for === proofKey ? proof : null;
  const mock = server?.resolver === "mock";

  async function getProof() {
    setErr(null);
    const res = await fetch("/api/x/proof", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle, wallet: address }),
    });
    const body = (await res.json()) as { text?: string; intentUrl?: string; error?: string };
    if (!res.ok || !body.text || !body.intentUrl) return setErr(body.error || "Could not create a proof");
    setProof({ text: body.text, intentUrl: body.intentUrl, for: proofKey });
  }

  return (
    <div className="card space-y-5 p-6">
      <Step n={1} title="Your X account">
        <input className="input" placeholder="@username" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Your X username" autoCapitalize="none" />
        {prof ? (
          <div className="mt-3 flex items-center gap-3">
            <XAvatar handle={handle} image={prof.image} size={40} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">{prof.name}</div>
              <div className="text-[13px] text-ink-2">@{handle}</div>
            </div>
          </div>
        ) : valid && profiles.data && prof === null ? (
          <p className="mt-2 text-[13px] text-down-ink">@{handle} doesn&apos;t exist on X.</p>
        ) : null}
      </Step>

      {prof ? <Balance xId={xId} /> : null}

      <Step n={2} title="Wallet to receive the ETH">
        {isConnected ? (
          <p className="num text-[15px]">{address}</p>
        ) : (
          <button className="btn-primary" onClick={openConnectModal}>
            Connect wallet
          </button>
        )}
      </Step>

      <Step n={3} title="Post this on X">
        {!currentProof ? (
          <button className="btn-secondary" disabled={!prof || !isConnected} onClick={getProof}>
            Create my proof post
          </button>
        ) : (
          <div className="space-y-3">
            <pre className="whitespace-pre-wrap rounded-2xl bg-card-2 p-4 font-mono text-[13px]">{currentProof.text}</pre>
            <div className="flex flex-wrap gap-2">
              <a className="btn-primary" href={currentProof.intentUrl} target="_blank" rel="noreferrer">
                Post on X
              </a>
              <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(currentProof.text)}>
                Copy text
              </button>
            </div>
            <p className="text-[12px] text-ink-2">Post it from @{handle}. You can delete it after claiming. The code only works for this wallet and expires tomorrow.</p>
          </div>
        )}
        {err ? <p className="mt-2 text-[13px] text-down-ink">{err}</p> : null}
      </Step>

      <Step n={4} title="Paste the link to your post">
        <input
          className="input"
          placeholder={mock ? "mock:username (local mode)" : "https://x.com/you/status/…"}
          value={postUrl}
          onChange={(e) => setPostUrl(e.target.value)}
          aria-label="Link to your post"
        />
      </Step>

      <button
        className="btn-sticker w-full py-3.5 text-[16px]"
        disabled={Boolean(busy) || (isConnected && !postUrl.trim()) || (earnings.data !== undefined && earnings.data[0][0] === 0n)}
        onClick={() => claim({ proofUrl: postUrl.trim() })}
      >
        {!isConnected ? "Connect wallet" : busy ?? (earnings.data && earnings.data[0][0] === 0n ? "Nothing to claim yet" : "Verify & claim")}
      </button>
      <Result msg={msg} />

      {server?.xLogin || server?.devLogin ? (
        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-line pt-4 text-[13px] text-ink-2">
          <span>Or</span>
          {server.xLogin ? (
            <button className="btn-secondary px-4 py-2 text-[13px]" onClick={() => signIn("twitter")}>
              Sign in with X
            </button>
          ) : null}
          {server.devLogin ? <DevLogin /> : null}
        </div>
      ) : null}
    </div>
  );
}

function DevLogin() {
  const [name, setName] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        signIn("dev", { username: name, redirect: false }).then(() => location.reload());
      }}
    >
      <input className="input !w-40 !py-2" placeholder="dev username" value={name} onChange={(e) => setName(e.target.value)} aria-label="Dev username" />
      <button className="btn-secondary px-4 py-2 text-[13px]" type="submit">
        Dev login
      </button>
    </form>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-outline bg-lime text-[13px] font-bold text-[#1d1d1f]">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="mb-2 text-[15px] font-semibold">{title}</div>
        {children}
      </div>
    </div>
  );
}

/** Signed in through X OAuth (or dev login). */
function SessionClaim({ x }: { x: { id: string; username: string; name?: string; image?: string } }) {
  const xId = BigInt(x.id);
  const earnings = useEarnings(xId);
  const { claim, busy, msg, address, isConnected } = useClaim(() => earnings.refetch());
  const claimable = earnings.data?.[0][0];

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
        <Balance xId={xId} />
        <button className="btn-sticker w-full py-3.5 text-[16px]" disabled={Boolean(busy) || (isConnected && !claimable)} onClick={() => claim()}>
          {!isConnected ? "Connect wallet to claim" : busy ?? (claimable ? `Claim to ${shortAddress(address!)}` : "Nothing to claim yet")}
        </button>
        <Result msg={msg} />
      </div>
      <Streams xId={xId} username={x.username} />
    </>
  );
}

function Streams({ xId, username }: { xId: bigint; username: string }) {
  const { data: tokens } = useTokens(200);
  const streams = useMemo(
    () =>
      (tokens ?? [])
        .map((t) => ({ t, i: t.xIds.findIndex((id) => id === xId) }))
        .filter((s) => s.i >= 0)
        .map(({ t, i }) => ({ t, bps: t.bps[i], fromToken: (t.creatorFees * BigInt(t.bps[i])) / 10_000n })),
    [tokens, xId]
  );
  return (
    <div className="card p-5">
      <h2 className="text-[17px] font-semibold">Fee streams for @{username}</h2>
      {streams.length === 0 ? (
        <p className="mt-2 text-[14px] text-ink-2">
          No coins list @{username} yet.{" "}
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
                  <div className="text-[12px] text-ink-2">
                    ${t.symbol} · share {pct(bps)}
                  </div>
                </div>
                <span className="num text-[14px] font-semibold">{formatEth(fromToken, 5)} Ξ</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
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
    <div className="space-y-4">
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
      {prof ? <Streams xId={BigInt(prof.id)} username={handle} /> : null}
    </div>
  );
}
