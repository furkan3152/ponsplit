"use client";

import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ADMIN_WALLET } from "@/lib/admin-config";
import { errorMessage, formatSol } from "@/lib/format";
import {
  closeUnusedProgram, quoteUnusedProgramRefund,
  type DeployWallet, type ProgramArtifact,
} from "@/lib/solana/program-deploy";

export function ProgramRentRecovery({ wallet, artifact, authorize, onClosed, onBusyChange, disabled }: {
  wallet: DeployWallet | null; artifact?: ProgramArtifact; disabled: boolean;
  authorize: () => Promise<void>; onClosed: (programId: string) => void; onBusyChange: (busy: boolean) => void;
}) {
  const { connection } = useConnection();
  const [program, setProgram] = useState("");
  const [inspected, setInspected] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [unused, setUnused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const inFlight = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const quote = useQuery({
    queryKey: ["admin-unused-program-refund", connection.rpcEndpoint, inspected, artifact?.manifest.sha256],
    enabled: Boolean(wallet?.publicKey?.equals(ADMIN_WALLET) && artifact && inspected && !closed),
    queryFn: () => quoteUnusedProgramRefund(connection, new PublicKey(inspected!), artifact!),
    retry: false,
    staleTime: 0,
  });
  const ready = Boolean(!disabled && wallet && artifact && quote.data && !quote.isFetching && !quote.error &&
    !closed && unused && confirmation === inspected && program.trim() === inspected);

  async function closeProgram() {
    if (!ready || !wallet || !artifact || !inspected || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    onBusyChange(true);
    setMessage(null);
    setReceipt(null);
    try {
      await authorize();
      if (!active.current) throw new Error("Unlock the admin dashboard again.");
      const signature = await closeUnusedProgram({
        connection, program: new PublicKey(inspected), artifact,
        confirmedProgramId: confirmation,
        wallet: { publicKey: wallet.publicKey, signTransaction: async (tx) => {
          if (!active.current) throw new Error("The dashboard was locked.");
          const signed = await wallet.signTransaction(tx);
          if (!active.current) throw new Error("The dashboard was locked before broadcasting.");
          return signed;
        } },
        onSent: setReceipt,
      });
      setReceipt(signature);
      setClosed(true);
      setUnused(false);
      setConfirmation("");
      setMessage("Unused deployment closed. ProgramData rent was returned to the admin wallet. This program can no longer run.");
      onClosed(inspected);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
      onBusyChange(false);
      inFlight.current = false;
    }
  }

  return (
    <details className="mt-6 border-t border-line pt-5">
      <summary className="cursor-pointer text-[14px] font-semibold">Recover rent from an unused program</summary>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        Program rent stays locked while the program runs. This action permanently
        closes an unused deployment and returns its ProgramData balance to your
        admin wallet. Transaction fees and the small program-address account rent
        are not returned. Your upgrade authority is retained during normal operation;
        no renounce action is offered here.
      </p>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        The configured site program and any program with creator or other owned
        accounts are blocked, even if their claimable balance is zero. Only inspect
        a deployment that has never been used or configured on any site. Do not
        configure or use it while closing it. Checks run again after wallet approval;
        they are not an on-chain shutdown lock.
      </p>
      <label className="label mt-4" htmlFor="refund-program-id">Unused program ID</label>
      <input id="refund-program-id" className="input font-mono text-[12px]" value={program}
        disabled={busy || disabled} autoComplete="off" spellCheck={false}
        onChange={(event) => {
          setProgram(event.target.value); setInspected(null); setConfirmation("");
          setUnused(false); setClosed(false); setMessage(null); setReceipt(null);
        }} placeholder="Public address of the unused deployment" />
      <button type="button" className="btn-secondary mt-3 px-4 py-2 text-[12px]" disabled={busy || disabled || !wallet || !artifact || !program.trim()}
        onClick={() => {
          try {
            const address = new PublicKey(program.trim()).toBase58();
            setMessage(null); setConfirmation(""); setUnused(false);
            if (address === inspected) void quote.refetch();
            else setInspected(address);
          } catch { setMessage("Enter a valid public program ID."); }
        }}>Inspect rent and usage</button>
      {quote.isFetching ? <p role="status" className="mt-3 text-[12px] text-ink-3">Checking authority, bytecode, site configuration and creator accounts…</p> : null}
      {quote.error ? <p role="alert" className="mt-3 text-[13px] text-down-ink">{errorMessage(quote.error)}</p> : null}
      {quote.data && !quote.error && !closed ? (
        <div className="mt-4 space-y-3 border border-line bg-card-2 p-4 text-[13px]">
          <dl className="space-y-2">
            <div className="flex justify-between gap-3"><dt>ProgramData rent returned</dt><dd className="font-mono">{formatSol(quote.data.refundLamports, 6)} SOL</dd></div>
            <div className="flex justify-between gap-3"><dt>Estimated network fee</dt><dd className="font-mono">{formatSol(quote.data.feeLamports, 6)} SOL</dd></div>
            <div className="flex justify-between gap-3"><dt>Program-address rent retained</dt><dd className="font-mono">{formatSol(quote.data.retainedProgramLamports, 6)} SOL</dd></div>
          </dl>
          <p className="break-all font-mono text-[11px] text-ink-3">Refund recipient: {ADMIN_WALLET.toBase58()}</p>
          <label className="flex items-start gap-2 text-[12px] leading-relaxed">
            <input type="checkbox" checked={unused} disabled={busy || disabled} onChange={(event) => setUnused(event.target.checked)} className="mt-1" />
            I confirm this deployment has never been used or configured on any site, and I want to permanently disable it.
          </label>
          <label className="label" htmlFor="confirm-program-close">Type the same program ID to confirm permanent closure</label>
          <input id="confirm-program-close" className="input font-mono text-[12px]" value={confirmation}
            disabled={busy || disabled} autoComplete="off" spellCheck={false} onChange={(event) => setConfirmation(event.target.value)} />
          <button type="button" className="btn-secondary w-full px-4 py-3 text-[13px] text-down-ink" disabled={!ready || busy}
            onClick={() => { void closeProgram(); }}>{busy ? "Checking and closing…" : "Permanently close unused program and recover rent"}</button>
        </div>
      ) : null}
      {message ? <p role={closed ? "status" : "alert"} className={`mt-3 text-[13px] ${closed ? "text-up-ink" : "text-down-ink"}`}>{message}</p> : null}
      {receipt ? <a className="mt-3 block text-[12px] text-neon hover:underline" href={`https://solscan.io/tx/${receipt}`} target="_blank" rel="noreferrer">Check refund transaction before retrying ↗</a> : null}
    </details>
  );
}
