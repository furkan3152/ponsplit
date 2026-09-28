"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { formatEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { GraduatedArt } from "@/components/art";
import { feeVaultAbi, launchpadAbi } from "@/lib/abi";
import { activeChain, explorerUrl } from "@/lib/chains";
import { FAUCET_URL } from "@/lib/config";
import { errorMessage, shortAddress } from "@/lib/format";

type Status = {
  error?: string;
  chain: string;
  admin?: `0x${string}`;
  balance?: string;
  nonce?: number;
  vault?: `0x${string}`;
  launchpad?: `0x${string}`;
  vaultDeployed: boolean;
  launchpadDeployed: boolean;
  wired: boolean;
  addressesMatch: boolean;
  done: boolean;
  testnet: boolean;
  ownerTarget?: `0x${string}`;
  owner?: `0x${string}`;
  pendingOwner?: `0x${string}`;
  vaultOwner?: `0x${string}`;
  vaultPendingOwner?: `0x${string}`;
  ownershipDone: boolean;
  ownershipProposed: boolean;
  launchesPaused?: boolean;
  claimsPaused?: boolean;
};

const STORAGE_KEY = "ponsplit:pending-admin-key";

function load(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function save(v: string | null) {
  try {
    if (v) localStorage.setItem(STORAGE_KEY, v);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable: the key just isn't remembered
  }
}

export default function SetupPage() {
  const { data: s, refetch, isLoading } = useQuery({
    queryKey: ["setup"],
    refetchInterval: 6_000,
    queryFn: async () => (await (await fetch("/api/setup")).json()) as Status,
  });
  const [deploying, setDeploying] = useState(false);
  const [deployErr, setDeployErr] = useState<string | null>(null);
  const [txs, setTxs] = useState<string[]>([]);

  const funded = s?.balance !== undefined && s.balance !== "0";
  const step = !s?.admin ? 1 : !funded && !s.done ? 2 : !s.done ? 3 : !s.ownershipDone ? 4 : 5;
  const testnet = s?.testnet ?? true;

  async function deploy() {
    setDeploying(true);
    setDeployErr(null);
    try {
      const res = await fetch("/api/setup", { method: "POST" });
      const body = (await res.json()) as { error?: string; txs?: string[] };
      if (!res.ok) throw new Error(body.error || "Setup failed");
      setTxs((t) => [...t, ...(body.txs ?? [])]);
    } catch (e) {
      setDeployErr(errorMessage(e));
    } finally {
      setDeploying(false);
      refetch();
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-4">
      <div>
        <h1 className="font-display text-[40px] font-bold tracking-[-0.03em]">Set up PonSplit</h1>
        <p className="mt-1 text-[15px] text-ink-2">A few taps, all from your phone. Network: {s?.chain ?? "…"}.</p>
      </div>

      {isLoading ? <div className="card h-40 animate-pulse" /> : null}
      {s?.error ? <p className="card p-5 text-[14px] text-down-ink">Status check failed: {s.error}</p> : null}

      <StepCard n={1} title="Create the admin key" state={step > 1 ? "done" : "active"}>
        {step > 1 ? (
          <p className="text-[14px] text-ink-2">
            The server is using admin <span className="num break-all text-ink">{s?.admin}</span>.
          </p>
        ) : (
          <KeyGenerator />
        )}
      </StepCard>

      <StepCard n={2} title={testnet ? "Get free test ETH" : "Fund the admin address"} state={step > 2 ? "done" : step === 2 ? "active" : "todo"}>
        {s?.admin ? (
          <div className="space-y-3">
            <p className="text-[14px] text-ink-2">
              {testnet
                ? "Open the faucet, paste this address and request ETH."
                : "Send about 0.01 ETH on Robinhood Chain to this address; it pays the gas for deployment and signs nothing else on-chain."}{" "}
              This page updates by itself.
              {funded ? <span className="ml-1 font-semibold text-up-ink">Balance: {formatEther(BigInt(s.balance!))} ETH ✓</span> : null}
            </p>
            <CopyField value={s.admin} />
            {!funded && testnet ? (
              <a className="btn-primary" href={FAUCET_URL} target="_blank" rel="noreferrer">
                Open faucet ↗
              </a>
            ) : null}
          </div>
        ) : (
          <p className="text-[14px] text-ink-2">Finish step 1 first.</p>
        )}
      </StepCard>

      <StepCard n={3} title="Deploy the contracts" state={step > 3 ? "done" : step === 3 ? "active" : "todo"}>
        {s?.done ? (
          <ul className="space-y-1 text-[14px]">
            <li>
              FeeVault{" "}
              <a className="num break-all underline" href={explorerUrl("address", s.vault!)} target="_blank" rel="noreferrer">
                {s.vault}
              </a>
            </li>
            <li>
              Launchpad{" "}
              <a className="num break-all underline" href={explorerUrl("address", s.launchpad!)} target="_blank" rel="noreferrer">
                {s.launchpad}
              </a>
            </li>
          </ul>
        ) : (
          <div className="space-y-3">
            <p className="text-[14px] text-ink-2">One tap. The server sends three transactions with the admin key (about 20 seconds).</p>
            <button className="btn-sticker" disabled={step !== 3 || deploying} onClick={deploy}>
              {deploying ? "Deploying…" : "Deploy contracts"}
            </button>
            {deployErr ? <p className="text-[13px] text-down-ink">{deployErr}</p> : null}
          </div>
        )}
        {txs.length ? (
          <ul className="mt-3 space-y-1 text-[12px] text-ink-2">
            {txs.map((t) => (
              <li key={t}>
                <a className="num underline" href={explorerUrl("tx", t)} target="_blank" rel="noreferrer">
                  {t.slice(0, 18)}…
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </StepCard>

      <StepCard n={4} title="Hand ownership to your wallet" state={step > 4 ? "done" : step === 4 ? "active" : "todo"}>
        <Ownership s={s} onDone={() => refetch()} onStart={deploy} busy={deploying} />
      </StepCard>

      {s?.launchesPaused || s?.claimsPaused ? (
        <p className="card p-4 text-[14px] font-medium text-down-ink">
          Paused by the owner: {[s.launchesPaused && "new launches", s.claimsPaused && "claims"].filter(Boolean).join(" and ")}.
        </p>
      ) : null}

      {s?.done ? (
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <GraduatedArt className="h-20 w-20" />
          <h2 className="font-display text-[26px] font-bold tracking-tight">You&apos;re live 🎉</h2>
          {s.addressesMatch ? (
            <p className="text-[15px] text-ink-2">Everything is set. Launch the first coin.</p>
          ) : (
            <p className="text-[15px] text-down-ink">
              The contracts are deployed, but this build points at different addresses (from src/deployment.json or NEXT_PUBLIC_* variables). Clear those and redeploy.
            </p>
          )}
          <Link href="/create" className="btn-sticker">
            Launch a coin
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** Two-step transfer: the server proposes OWNER_ADDRESS, that wallet accepts here. */
function Ownership({ s, onDone, onStart, busy }: { s?: Status; onDone: () => void; onStart: () => void; busy: boolean }) {
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { writeContractAsync } = useWriteContract();
  const [accepting, setAccepting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!s?.done) return <p className="text-[14px] text-ink-2">After the contracts are deployed.</p>;
  if (!s.ownerTarget) {
    return (
      <p className={`text-[14px] ${s.testnet ? "text-ink-2" : "font-medium text-down-ink"}`}>
        {s.testnet ? "Optional on testnet. " : "Strongly recommended on mainnet. "}
        The admin key on the server owns the contracts right now
        {s.owner ? ` (${shortAddress(s.owner)})` : ""}. Set <code className="num rounded bg-card-2 px-1">OWNER_ADDRESS</code> on your host to a wallet you
        control, ideally a multisig, redeploy, and come back here.
      </p>
    );
  }
  if (s.ownershipDone) {
    return (
      <p className="text-[14px] text-ink-2">
        Owned by <span className="num break-all text-ink">{s.owner}</span>. The server key only signs launches and claims.
      </p>
    );
  }
  if (!s.ownershipProposed) {
    return (
      <div className="space-y-3">
        <p className="text-[14px] text-ink-2">
          Propose <span className="num break-all text-ink">{s.ownerTarget}</span> as the owner of both contracts.
        </p>
        <button className="btn-primary" disabled={busy} onClick={onStart}>
          {busy ? "Proposing…" : "Propose new owner"}
        </button>
      </div>
    );
  }

  const isTarget = address?.toLowerCase() === s.ownerTarget.toLowerCase();
  // Only contracts still waiting on this wallet, so a half-finished accept can simply be retried.
  const waiting = [
    { addr: s.vault, abi: feeVaultAbi, pending: s.vaultPendingOwner, owner: s.vaultOwner },
    { addr: s.launchpad, abi: launchpadAbi, pending: s.pendingOwner, owner: s.owner },
  ].filter((c) => c.addr && c.pending === s.ownerTarget && c.owner !== s.ownerTarget);
  async function accept() {
    setErr(null);
    if (!isConnected) return openConnectModal?.();
    if (!publicClient || !s?.vault || !s.launchpad) return;
    setAccepting(true);
    try {
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      for (const c of waiting) {
        const hash = await writeContractAsync({ address: c.addr!, abi: c.abi, chainId: activeChain.id, functionName: "acceptOwnership" });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Transaction reverted");
      }
      onDone();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setAccepting(false);
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-[14px] text-ink-2">
        Connect <span className="num break-all text-ink">{s.ownerTarget}</span> and accept.{" "}
        {waiting.length === 2 ? "Two transactions, one per contract." : "One transaction left."}
      </p>
      <button className="btn-sticker" disabled={accepting || (isConnected && !isTarget)} onClick={accept}>
        {!isConnected ? "Connect owner wallet" : !isTarget ? "Switch to the owner wallet" : accepting ? "Accepting…" : "Accept ownership"}
      </button>
      {err ? <p className="text-[13px] text-down-ink">{err}</p> : null}
    </div>
  );
}

function KeyGenerator() {
  const [key, setKey] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => setKey(load()), []);
  const address = key ? privateKeyToAccount(key as `0x${string}`).address : undefined;

  if (!key) {
    return (
      <div className="space-y-3">
        <p className="text-[14px] text-ink-2">
          PonSplit needs one key that deploys the contracts and signs launches and claims. A Render Blueprint deploy creates it automatically (SIGNER_SEED). Otherwise create it here in your browser; it is never sent anywhere.
        </p>
        <button
          className="btn-primary"
          onClick={() => {
            const k = generatePrivateKey();
            save(k);
            setKey(k);
          }}
        >
          Generate admin key
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-[14px]">
      <p className="text-ink-2">
        Address <span className="num break-all text-ink">{address}</span>
      </p>
      <div>
        <div className="label">Private key: keep it secret, save it somewhere safe</div>
        <div className="flex gap-2">
          <input readOnly className="input num text-[12px]" type={shown ? "text" : "password"} value={key} aria-label="Admin private key" />
          <button className="btn-secondary shrink-0 px-3" onClick={() => setShown((v) => !v)}>
            {shown ? "Hide" : "Show"}
          </button>
          <button className="btn-secondary shrink-0 px-3" onClick={() => navigator.clipboard.writeText(key)}>
            Copy
          </button>
        </div>
      </div>
      <p className="text-ink-2">
        Add it to your host as <code className="num rounded bg-card-2 px-1">SIGNER_PRIVATE_KEY</code>, then come back here:
      </p>
      <ul className="list-disc space-y-1 pl-5 text-ink-2">
        <li>
          <a className="font-medium text-ink underline" href="https://dashboard.render.com" target="_blank" rel="noreferrer">
            Render
          </a>
          : your service → <b>Environment</b> → <b>Add</b> → paste → <b>Save, rebuild, and deploy</b>.
        </li>
        <li>
          <a className="font-medium text-ink underline" href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">
            Vercel
          </a>
          : project → <b>Settings</b> → <b>Environment Variables</b> → add and save → <b>Deployments</b> → ⋯ → <b>Redeploy</b>.
        </li>
      </ul>
      <button
        className="text-[12px] text-ink-3 underline"
        onClick={() => {
          save(null);
          setKey(null);
        }}
      >
        Forget this key on this device
      </button>
    </div>
  );
}

function StepCard({ n, title, state, children }: { n: number; title: string; state: "todo" | "active" | "done"; children: React.ReactNode }) {
  return (
    <section className={`card p-5 ${state === "todo" ? "opacity-50" : ""}`}>
      <div className="mb-3 flex items-center gap-3">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-outline text-[14px] font-bold text-[#1d1d1f] ${
            state === "done" ? "bg-up" : "bg-lime"
          }`}
        >
          {state === "done" ? "✓" : n}
        </span>
        <h2 className="text-[17px] font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly className="input num text-[13px]" value={value} aria-label="Admin address" />
      <button
        className="btn-secondary shrink-0 px-3"
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
