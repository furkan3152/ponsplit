"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { signIn, signOut, useSession } from "next-auth/react";
import { useState } from "react";
import type { Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { feeVaultAbi } from "@/lib/abi";
import { activeChain, explorerUrl } from "@/lib/chains";
import { FEE_VAULT_ADDRESS } from "@/lib/config";
import { errorMessage, formatEth, shortAddress } from "@/lib/format";
import { handleHash, isValidHandle, normalizeHandle } from "@/lib/handles";

function useEarnings(handle: string | undefined) {
  const hash = handle && isValidHandle(handle) ? handleHash(handle) : undefined;
  const enabled = Boolean(hash && FEE_VAULT_ADDRESS);
  const claimable = useReadContract({
    address: FEE_VAULT_ADDRESS,
    abi: feeVaultAbi,
    chainId: activeChain.id,
    functionName: "claimable",
    args: hash ? [hash] : undefined,
    query: { enabled, refetchInterval: 15_000 },
  });
  const earned = useReadContract({
    address: FEE_VAULT_ADDRESS,
    abi: feeVaultAbi,
    chainId: activeChain.id,
    functionName: "totalEarned",
    args: hash ? [hash] : undefined,
    query: { enabled },
  });
  return { claimable: claimable.data, earned: earned.data, refetch: () => (claimable.refetch(), earned.refetch()) };
}

export default function ClaimPage() {
  const { data: session, status } = useSession();
  const username = session?.xUsername;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Claim your fees</h1>
        <p className="mt-1 text-sm text-mute">
          Fees are held for your X account. Sign in with X to prove it is yours, then send them to any wallet.
        </p>
      </div>

      {status === "loading" ? (
        <div className="card h-48 animate-pulse" />
      ) : username ? (
        <ClaimCard username={username} />
      ) : (
        <div className="card space-y-4 p-6 text-center">
          <p className="text-sm text-mute">Step 1: verify your X account.</p>
          <button className="btn-primary px-6" onClick={() => signIn("twitter")}>
            Sign in with X
          </button>
        </div>
      )}

      <Lookup />
    </div>
  );
}

function ClaimCard({ username }: { username: string }) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { writeContractAsync } = useWriteContract();
  const { claimable, earned, refetch } = useEarnings(username);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; tx?: string } | null>(null);

  async function claim() {
    setMsg(null);
    if (!isConnected || !address) return openConnectModal?.();
    if (!FEE_VAULT_ADDRESS || !publicClient) return;
    try {
      setBusy("Getting signature…");
      const res = await fetch("/api/claim-signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: address }),
      });
      const data = (await res.json()) as { error?: string; handleHash: Hex; deadline: string; signature: Hex };
      if (!res.ok) throw new Error(data.error || "Could not get a claim signature");

      setBusy("Confirm in your wallet…");
      const hash = await writeContractAsync({
        address: FEE_VAULT_ADDRESS,
        abi: feeVaultAbi,
        chainId: activeChain.id,
        functionName: "claim",
        args: [data.handleHash, address, BigInt(data.deadline), data.signature],
      });
      setBusy("Claiming…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      setMsg({ kind: "ok", text: "Claimed.", tx: hash });
      refetch();
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-mute">Signed in as</div>
          <div className="font-mono text-lg">@{username}</div>
        </div>
        <button className="text-xs text-mute hover:text-white" onClick={() => signOut({ redirect: false })}>
          Sign out
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-ink-800 p-4">
          <div className="font-mono text-2xl text-lime">{claimable !== undefined ? formatEth(claimable, 6) : "–"}</div>
          <div className="text-xs text-mute">ETH claimable</div>
        </div>
        <div className="rounded-xl bg-ink-800 p-4">
          <div className="font-mono text-2xl">{earned !== undefined ? formatEth(earned, 6) : "–"}</div>
          <div className="text-xs text-mute">ETH earned all-time</div>
        </div>
      </div>

      <button className="btn-primary w-full py-3" disabled={Boolean(busy) || (isConnected && !claimable)} onClick={claim}>
        {!isConnected ? "Connect wallet to claim" : busy ?? (claimable ? `Claim to ${shortAddress(address!)}` : "Nothing to claim yet")}
      </button>
      {msg ? (
        <p className={`text-sm ${msg.kind === "ok" ? "text-lime" : "text-red-300"}`}>
          {msg.text}{" "}
          {msg.tx ? (
            <a className="underline" href={explorerUrl("tx", msg.tx)} target="_blank" rel="noreferrer">
              View transaction
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function Lookup() {
  const [input, setInput] = useState("");
  const handle = normalizeHandle(input);
  const valid = isValidHandle(handle);
  const { claimable, earned } = useEarnings(valid ? handle : undefined);

  return (
    <div className="card space-y-3 p-5">
      <label className="label">Check any X account</label>
      <input className="input font-mono" placeholder="@username" value={input} onChange={(e) => setInput(e.target.value)} />
      {valid ? (
        <p className="font-mono text-sm text-mute">
          @{handle}: <span className="text-lime">{claimable !== undefined ? formatEth(claimable, 6) : "…"} ETH</span> claimable ·{" "}
          {earned !== undefined ? formatEth(earned, 6) : "…"} ETH earned
        </p>
      ) : null}
    </div>
  );
}
