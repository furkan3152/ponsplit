"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { GraduatedArt } from "@/components/art";
import { explorerUrl } from "@/lib/chains";
import { FAUCET_URL } from "@/lib/config";
import { errorMessage } from "@/lib/format";

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
  const step = !s?.admin ? 1 : !funded && !s.done ? 2 : !s.done ? 3 : 4;

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
        <p className="mt-1 text-[15px] text-ink-2">Three steps, all from your phone. Network: {s?.chain ?? "…"}.</p>
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

      <StepCard n={2} title="Get free test ETH" state={step > 2 ? "done" : step === 2 ? "active" : "todo"}>
        {s?.admin ? (
          <div className="space-y-3">
            <p className="text-[14px] text-ink-2">
              Open the faucet, paste this address and request ETH. This page updates by itself.
              {funded ? <span className="ml-1 font-semibold text-up-ink">Balance: {formatEther(BigInt(s.balance!))} ETH ✓</span> : null}
            </p>
            <CopyField value={s.admin} />
            {!funded ? (
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

function KeyGenerator() {
  const [key, setKey] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => setKey(load()), []);
  const address = key ? privateKeyToAccount(key as `0x${string}`).address : undefined;

  if (!key) {
    return (
      <div className="space-y-3">
        <p className="text-[14px] text-ink-2">
          PonSplit needs one key that deploys the contracts and signs launches and claims. On Render this is automatic (the SIGNER_SEED variable from render.yaml). On other hosts, create it here in your browser; it is never sent anywhere.
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
      <ol className="list-decimal space-y-1 pl-5 text-ink-2">
        <li>
          Open your project on{" "}
          <a className="font-medium text-ink underline" href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">
            Vercel
          </a>{" "}
          → <b>Settings</b> → <b>Environment Variables</b>.
        </li>
        <li>
          Add <code className="num rounded bg-card-2 px-1">SIGNER_PRIVATE_KEY</code> with the copied key and save.
        </li>
        <li>
          <b>Deployments</b> → ⋯ on the latest → <b>Redeploy</b>. Then come back here.
        </li>
      </ol>
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
