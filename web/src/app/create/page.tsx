"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { decodeEventLog, formatEther, parseEther } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { launchpadAbi } from "@/lib/abi";
import { activeChain } from "@/lib/chains";
import { BPS, LAUNCHPAD_ADDRESS, MAX_RECIPIENTS } from "@/lib/config";
import { errorMessage, pct } from "@/lib/format";
import { isValidHandle, normalizeHandle } from "@/lib/handles";

type Row = { handle: string; percent: string };

/** Parses "33.33" into basis points (3333). Returns NaN for anything else. */
function toBps(percent: string): number {
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(percent.trim())) return NaN;
  return Math.round(parseFloat(percent) * 100);
}

function safeParseEther(v: string): bigint | undefined {
  try {
    return v.trim() ? parseEther(v.trim()) : 0n;
  } catch {
    return undefined;
  }
}

function evenSplit(n: number): string[] {
  const base = Math.floor(BPS / n);
  return Array.from({ length: n }, (_, i) => ((i === 0 ? base + (BPS - base * n) : base) / 100).toString());
}

export default function CreatePage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { writeContractAsync } = useWriteContract();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<Row[]>([
    { handle: "", percent: "50" },
    { handle: "", percent: "50" },
  ]);
  const [devBuy, setDevBuy] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: creationFee } = useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    chainId: activeChain.id,
    functionName: "creationFee",
    query: { enabled: Boolean(LAUNCHPAD_ADDRESS) },
  });

  const handles = rows.map((r) => normalizeHandle(r.handle));
  const bps = rows.map((r) => toBps(r.percent));
  const totalBps = bps.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0);

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!name.trim() || name.length > 32) p.push("Name is required (max 32 characters).");
    if (!symbol.trim() || symbol.length > 10) p.push("Ticker is required (max 10 characters).");
    if (description.length > 500) p.push("Description is too long (max 500).");
    if (imageUrl.length > 256) p.push("Image URL is too long (max 256).");
    handles.forEach((h, i) => {
      if (!isValidHandle(h)) p.push(`Row ${i + 1}: enter a valid X username.`);
    });
    if (new Set(handles).size !== handles.length) p.push("Each X account can only appear once.");
    if (bps.some((b) => Number.isNaN(b) || b <= 0)) p.push("Every share must be above 0% (max 2 decimals).");
    else if (totalBps !== BPS) p.push(`Shares add up to ${pct(totalBps)}; they must total 100%.`);
    if (devBuy && safeParseEther(devBuy) === undefined) p.push("Initial buy must be a number.");
    return p;
  }, [name, symbol, description, imageUrl, handles, bps, totalBps, devBuy]);

  const devBuyWei = safeParseEther(devBuy);
  const value = (creationFee ?? 0n) + (devBuyWei ?? 0n);

  async function submit() {
    setError(null);
    if (!isConnected) return openConnectModal?.();
    if (!LAUNCHPAD_ADDRESS || !publicClient || problems.length) return;
    setBusy(true);
    try {
      setStatus("Confirm in your wallet…");
      const hash = await writeContractAsync({
        address: LAUNCHPAD_ADDRESS,
        abi: launchpadAbi,
        chainId: activeChain.id,
        functionName: "createToken",
        args: [name.trim(), symbol.trim().toUpperCase(), imageUrl.trim(), description.trim(), handles, bps, 0n],
        value,
      });
      setStatus("Launching…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: launchpadAbi, ...log });
          if (ev.eventName === "TokenCreated") return router.push(`/token/${ev.args.token}`);
        } catch {
          // not a launchpad event
        }
      }
      router.push("/");
    } catch (e) {
      setError(errorMessage(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Launch a token</h1>
        <p className="mt-1 text-sm text-mute">
          Creator fees from every trade on the curve are split between the X accounts below.
        </p>
      </div>

      <section className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <div>
            <label className="label">Name</label>
            <input className="input" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Pon Coin" />
          </div>
          <div>
            <label className="label">Ticker</label>
            <input
              className="input font-mono uppercase"
              maxLength={10}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.replace(/\s/g, ""))}
              placeholder="PON"
            />
          </div>
        </div>
        <div>
          <label className="label">Image URL</label>
          <input className="input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…/logo.png" />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea
            className="input min-h-24"
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this coin about?"
          />
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Fee split</h2>
            <p className="text-xs text-mute">Up to {MAX_RECIPIENTS} X accounts. Shares are fixed once launched.</p>
          </div>
          <button
            type="button"
            className="text-xs text-lime hover:underline"
            onClick={() => setRows((rs) => evenSplit(rs.length).map((p, i) => ({ ...rs[i], percent: p })))}
          >
            Split evenly
          </button>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute">@</span>
                <input
                  className="input pl-8 font-mono"
                  value={r.handle}
                  onChange={(e) => update(i, { handle: e.target.value.replace(/^@+/, "") })}
                  placeholder="username"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
              <div className="relative w-28">
                <input
                  className="input pr-7 text-right font-mono"
                  inputMode="decimal"
                  value={r.percent}
                  onChange={(e) => update(i, { percent: e.target.value })}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-mute">%</span>
              </div>
              <button
                type="button"
                className="btn-ghost w-10 px-0"
                disabled={rows.length === 1}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="btn-ghost"
            disabled={rows.length >= MAX_RECIPIENTS}
            onClick={() => setRows((rs) => [...rs, { handle: "", percent: "0" }])}
          >
            + Add account
          </button>
          <span className={`font-mono text-sm ${totalBps === BPS ? "text-lime" : "text-amber-300"}`}>total {pct(totalBps)}</span>
        </div>
      </section>

      <section className="card space-y-3 p-5">
        <div>
          <label className="label">Initial buy (optional)</label>
          <div className="relative">
            <input
              className="input pr-12 font-mono"
              inputMode="decimal"
              placeholder="0.0"
              value={devBuy}
              onChange={(e) => setDevBuy(e.target.value)}
            />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-mute">ETH</span>
          </div>
          <p className="mt-1.5 text-xs text-mute">Be the first buyer in the same transaction, before anyone else can trade.</p>
        </div>
        {creationFee ? <p className="text-xs text-mute">Creation fee: {formatEther(creationFee)} ETH</p> : null}
      </section>

      {problems.length > 0 && (name || symbol || handles.some(Boolean)) ? (
        <ul className="space-y-1 text-sm text-amber-300">
          {problems.map((p) => (
            <li key={p}>• {p}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      <button className="btn-primary w-full py-3 text-base" disabled={busy || (isConnected && problems.length > 0)} onClick={submit}>
        {!isConnected ? "Connect wallet" : busy ? status : "Launch token"}
      </button>
    </div>
  );
}
