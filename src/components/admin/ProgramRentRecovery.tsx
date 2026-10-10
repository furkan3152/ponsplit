"use client";

import { PublicKey, type Transaction } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ADMIN_WALLET } from "@/lib/admin-config";
import { ESCROW_PROGRAM_ID } from "@/lib/tiktok-config";
import { errorMessage, formatSol } from "@/lib/format";
import {
  closeActiveProgram, closeUnusedProgram, quoteActiveProgramRefund, quoteUnusedProgramRefund,
  type ActiveProgramRefundQuote, type DeployWallet, type ProgramArtifact, type ProgramRefundQuote,
} from "@/lib/solana/program-deploy";

export function ProgramRentRecovery({ wallet, artifact, authorize, onClosed, onBusyChange, disabled }: {
  wallet: DeployWallet | null; artifact?: ProgramArtifact; disabled: boolean;
  authorize: () => Promise<void>; onClosed: (programId: string) => void; onBusyChange: (busy: boolean) => void;
}) {
  const { connection } = useConnection();
  const configuredProgram = ESCROW_PROGRAM_ID?.toBase58() ?? "";
  const [mode, setMode] = useState<"active" | "unused">(configuredProgram ? "active" : "unused");
  const [program, setProgram] = useState(configuredProgram);
  const [inspected, setInspected] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [acknowledgedHash, setAcknowledgedHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const inFlight = useRef(false);
  const active = useRef(true);
  const current = useRef({ wallet: wallet?.publicKey?.toBase58(), endpoint: connection.rpcEndpoint, mode, program });
  current.current = { wallet: wallet?.publicKey?.toBase58(), endpoint: connection.rpcEndpoint, mode, program };
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const quote = useQuery<ProgramRefundQuote | ActiveProgramRefundQuote>({
    queryKey: [mode === "active" ? "admin-active-program-refund" : "admin-unused-program-refund", connection.rpcEndpoint, inspected, artifact?.manifest.sha256],
    enabled: Boolean(wallet?.publicKey?.equals(ADMIN_WALLET) && artifact && inspected && !closed),
    queryFn: () => mode === "active"
      ? quoteActiveProgramRefund(connection, new PublicKey(inspected!), artifact!)
      : quoteUnusedProgramRefund(connection, new PublicKey(inspected!), artifact!),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const activeQuote = quote.data && "affectedAccountsHash" in quote.data ? quote.data : null;
  const quoteHash = activeQuote?.affectedAccountsHash;
  useEffect(() => {
    setAcknowledged(false); setAcknowledgedHash(null); setConfirmation("");
  }, [quoteHash]);
  const ready = Boolean(!disabled && wallet?.publicKey?.equals(ADMIN_WALLET) && artifact && quote.data &&
    quote.data.programId === inspected && !quote.isFetching && !quote.error && !closed && acknowledged &&
    confirmation === inspected && program.trim() === inspected &&
    (mode === "unused" || (inspected === configuredProgram && activeQuote && acknowledgedHash === quoteHash)));

  function changeMode(next: "active" | "unused") {
    setMode(next);
    setProgram(next === "active" ? configuredProgram : "");
    setInspected(null); setConfirmation(""); setAcknowledged(false);
    setClosed(false); setMessage(null); setReceipt(null);
  }

  async function closeProgram() {
    if (!ready || !wallet?.publicKey || !artifact || !inspected || inFlight.current) return;
    const context = { wallet: wallet.publicKey.toBase58(), endpoint: connection.rpcEndpoint, mode, program };
    const assertCurrent = () => {
      if (!active.current || current.current.wallet !== context.wallet || current.current.endpoint !== context.endpoint ||
        current.current.mode !== context.mode || current.current.program !== context.program) {
        throw new Error("The admin wallet, network or recovery form changed. Inspect the program again.");
      }
    };
    const reviewedQuote = activeQuote;
    inFlight.current = true;
    setBusy(true);
    onBusyChange(true);
    setMessage(null);
    setReceipt(null);
    try {
      await authorize();
      assertCurrent();
      const options = {
        connection, program: new PublicKey(inspected), artifact,
        confirmedProgramId: confirmation,
        wallet: { publicKey: wallet.publicKey, signTransaction: async (tx: Transaction) => {
          assertCurrent();
          const signed = await wallet.signTransaction(tx);
          assertCurrent();
          return signed;
        } },
        onSent: (signature: string) => { assertCurrent(); setReceipt(signature); },
      };
      const signature = mode === "active"
        ? await closeActiveProgram({ ...options, acknowledgedCreatorFundsLoss: acknowledged,
          reviewedAffectedAccountsHash: reviewedQuote!.affectedAccountsHash })
        : await closeUnusedProgram(options);
      if (!active.current) return;
      setReceipt(signature);
      setClosed(true);
      setAcknowledged(false);
      setConfirmation("");
      setMessage(mode === "active"
        ? "Current escrow program closed. ProgramData rent was returned to the admin wallet. Creator verification, withdrawals and new escrow launches have stopped. Existing pump.fun tokens can still trade and generate fees."
        : "Unused deployment closed. ProgramData rent was returned to the admin wallet. This program can no longer run.");
      onClosed(inspected);
    } catch (error) {
      if (active.current) setMessage(errorMessage(error));
    } finally {
      if (active.current) { setBusy(false); onBusyChange(false); }
      inFlight.current = false;
    }
  }

  return (
    <section id="rent-recovery" aria-labelledby="rent-recovery-heading" className="mt-6 scroll-mt-24 border-t border-line pt-5">
      <div className="edition-label text-neon">Rent recovery</div>
      <h3 id="rent-recovery-heading" className="mt-2 text-[20px] font-semibold">Recover program rent</h3>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        For a remaining upload buffer, use <strong>Close buffer and recover its rent</strong> in the saved upload section above.
        The form below is for a deployed program.
      </p>
      <fieldset className="mt-4 flex flex-wrap gap-4 border border-line p-4" disabled={busy || disabled}>
        <legend className="px-1 text-[12px] text-ink-3">Choose the deployment to close</legend>
        {configuredProgram ? <label className="flex items-center gap-2 text-[13px]">
          <input type="radio" name="program-recovery-mode" checked={mode === "active"} onChange={() => changeMode("active")} />
          Close current program
        </label> : null}
        <label className="flex items-center gap-2 text-[13px]">
          <input type="radio" name="program-recovery-mode" checked={mode === "unused"} onChange={() => changeMode("unused")} />
          Recover unused deployment
        </label>
      </fieldset>
      {mode === "active" ? (
        <div className="mt-4 border border-down-ink/40 bg-card-2 p-4 text-[12px] leading-relaxed">
          <p className="font-semibold text-down-ink">Permanent shutdown of the current escrow</p>
          <a className="mt-2 block break-all font-mono text-neon hover:underline" href={`https://solscan.io/account/${configuredProgram}`} target="_blank" rel="noreferrer">{configuredProgram} ↗</a>
          <p className="mt-2 text-ink-2">Closing this program stops new escrow launches, TikTok verification and creator withdrawals. Existing creator accounts stay on-chain, and their funds can become inaccessible. Existing pump.fun tokens can continue trading and sending future fees to those inaccessible vaults.</p>
          <p className="mt-2 text-down-ink">Only ProgramData rent is refunded. Creator funds are not returned to you or their creators. Treat this closure as irreversible.</p>
        </div>
      ) : <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
        The configured site program and any program with creator or other owned accounts are blocked in this mode,
        even if their claimable balance is zero. Only inspect a deployment that has never been used or configured on any site.
      </p>}
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        Program rent stays locked while the program runs. This action permanently
        closes the selected deployment and returns its ProgramData balance to your
        admin wallet. Transaction fees and the small program-address account rent
        are not returned. Your upgrade authority is retained during normal operation;
        no renounce action is offered here.
      </p>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        Do not configure or use the program while closing it. Checks run again after wallet approval;
        they are not an on-chain shutdown lock.
      </p>
      <label className="label mt-4" htmlFor="refund-program-id">{mode === "active" ? "Current program ID" : "Unused program ID"}</label>
      <input id="refund-program-id" className="input font-mono text-[12px]" value={program}
        disabled={busy || disabled} readOnly={mode === "active"} autoComplete="off" spellCheck={false}
        onChange={(event) => {
          setProgram(event.target.value); setInspected(null); setConfirmation("");
          setAcknowledged(false); setClosed(false); setMessage(null); setReceipt(null);
        }} placeholder="Public address of the unused deployment" />
      <button type="button" className="btn-secondary mt-3 px-4 py-2 text-[12px]" disabled={busy || disabled || !wallet || !artifact || !program.trim()}
        onClick={() => {
          try {
            const address = new PublicKey(program.trim()).toBase58();
            setMessage(null); setConfirmation(""); setAcknowledged(false);
            if (address === inspected) void quote.refetch();
            else setInspected(address);
          } catch { setMessage("Enter a valid public program ID."); }
        }}>Inspect rent and usage</button>
      {quote.isFetching ? <p role="status" className="mt-3 text-[12px] text-ink-3">Checking authority, bytecode, site configuration and creator accounts…</p> : null}
      {quote.error ? <p role="alert" className="mt-3 text-[13px] text-down-ink">{errorMessage(quote.error)}</p> : null}
      {quote.data && !quote.error && !closed ? (
        <div className="mt-4 space-y-3 border border-line bg-card-2 p-4 text-[13px]">
          <dl className="space-y-2">
            <div className="flex justify-between gap-3"><dt>ProgramData refund before network fee</dt><dd className="font-mono">{formatSol(quote.data.refundLamports, 6)} SOL</dd></div>
            <div className="flex justify-between gap-3"><dt>Maximum network fee</dt><dd className="font-mono">{formatSol(quote.data.feeLamports, 6)} SOL</dd></div>
            <div className="flex justify-between gap-3"><dt>Program-address rent retained</dt><dd className="font-mono">{formatSol(quote.data.retainedProgramLamports, 6)} SOL</dd></div>
          </dl>
          {mode === "active" && activeQuote ? <div className="border-t border-line pt-3">
            <dl className="space-y-2">
              <div className="flex justify-between gap-3"><dt>Affected program-owned accounts</dt><dd className="font-mono">{activeQuote.affectedAccountCount}</dd></div>
              <div className="flex justify-between gap-3"><dt>Affected creator vaults</dt><dd className="font-mono">{activeQuote.affectedCreatorVaultCount}</dd></div>
              <div className="flex justify-between gap-3"><dt>Creator funds above account rent at risk</dt><dd className="font-mono text-down-ink">{formatSol(activeQuote.affectedCreatorFundsLamports, 9)} SOL</dd></div>
              <div className="flex justify-between gap-3"><dt>All affected balances including rent</dt><dd className="font-mono">{formatSol(activeQuote.affectedLamports, 9)} SOL</dd></div>
            </dl>
            <p className="mt-3 text-[12px] leading-relaxed text-down-ink">These balances are not part of the refund. Future creator fees can also become inaccessible, even if the current balance is zero.</p>
          </div> : null}
          <p className="break-all font-mono text-[11px] text-ink-3">Refund recipient: {ADMIN_WALLET.toBase58()}</p>
          <label className="flex items-start gap-2 text-[12px] leading-relaxed">
            <input type="checkbox" checked={acknowledged && (mode === "unused" || acknowledgedHash === quoteHash)} disabled={busy || disabled}
              onChange={(event) => {
                setAcknowledged(event.target.checked);
                setAcknowledgedHash(event.target.checked && mode === "active" ? quoteHash ?? null : null);
              }} className="mt-1" />
            {mode === "active"
              ? "I understand that this stops the current escrow, verification and withdrawals, and can permanently lock existing creator funds and future fees. I want to close it and recover only its ProgramData rent."
              : "I confirm this deployment has never been used or configured on any site, and I want to permanently disable it."}
          </label>
          <label className="label" htmlFor="confirm-program-close">Type the same program ID to confirm permanent closure</label>
          <input id="confirm-program-close" className="input font-mono text-[12px]" value={confirmation}
            disabled={busy || disabled} autoComplete="off" spellCheck={false} onChange={(event) => setConfirmation(event.target.value)} />
          <button type="button" className="btn-secondary w-full px-4 py-3 text-[13px] text-down-ink" disabled={!ready || busy}
            onClick={() => { void closeProgram(); }}>{busy ? "Checking and closing…" : mode === "active" ? "Permanently close current program and recover rent" : "Permanently close unused program and recover rent"}</button>
        </div>
      ) : null}
      {message ? <p role={closed ? "status" : "alert"} className={`mt-3 text-[13px] ${closed ? "text-up-ink" : "text-down-ink"}`}>{message}</p> : null}
      {receipt ? <a className="mt-3 block text-[12px] text-neon hover:underline" href={`https://solscan.io/tx/${receipt}`} target="_blank" rel="noreferrer">Check refund transaction before retrying ↗</a> : null}
    </section>
  );
}
