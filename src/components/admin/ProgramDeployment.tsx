"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, type Transaction } from "@solana/web3.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ADMIN_WALLET } from "@/lib/admin-config";
import { errorMessage, formatSol, shortAddress } from "@/lib/format";
import { ESCROW_PROGRAM_ID } from "@/lib/tiktok-config";
import deployment from "@/tiktok-deployment.json";
import { ProgramRentRecovery } from "./ProgramRentRecovery";
import {
  closeDeploymentBuffer,
  deployEscrowProgram,
  inspectDeployedProgram,
  inspectDeploymentBuffer,
  loadEscrowArtifact,
  quoteProgramDeployment,
  remainingDeploymentBalance,
  MAX_WALLET_PRIORITY_FEE_LAMPORTS,
  DEFAULT_UPLOAD_SIGNING_BATCH,
  MAX_UPLOAD_SIGNING_BATCH,
  type DeployProgress,
} from "@/lib/solana/program-deploy";

const STORAGE_KEY = "tiksplit:admin-deployment:v1";
type SavedDeployment = {
  buffer?: string;
  programId?: string;
  signature?: string;
  lastSignature?: string;
  sha256: string;
};

class DeploymentWalletApprovalError extends Error {
  constructor(error: unknown) {
    const detail = error && typeof error === "object"
      ? error as { message?: unknown; code?: unknown; error?: unknown; cause?: unknown }
      : null;
    const message = typeof detail?.message === "string" ? detail.message : String(error);
    let code = "";
    let nested: unknown = detail;
    // Wallet adapters often wrap the provider's original error under `error`.
    for (let depth = 0; nested && typeof nested === "object" && depth < 3; depth++) {
      const value = nested as { code?: unknown; error?: unknown; cause?: unknown };
      if (typeof value.code === "number" || typeof value.code === "string") {
        code = ` (code ${value.code})`;
        break;
      }
      nested = value.error ?? value.cause;
    }
    super(`Wallet approval did not complete${code}: ${message}`);
    this.name = "DeploymentWalletApprovalError";
  }
}

function readSaved(): SavedDeployment | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as SavedDeployment | null;
    if (
      !value ||
      typeof value.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.sha256)
    )
      return null;
    for (const key of [value.buffer, value.programId])
      if (key) new PublicKey(key);
    return value;
  } catch {
    return null;
  }
}

export function ProgramDeployment({
  enabled,
  onProgramId,
  authorize,
}: {
  enabled: boolean;
  onProgramId: (programId: string) => void;
  authorize: () => Promise<void>;
}) {
  const { connection } = useConnection();
  const queryClient = useQueryClient();
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const allowed = Boolean(enabled && publicKey?.equals(ADMIN_WALLET));
  const currentAccess = useRef(allowed);
  currentAccess.current = allowed;
  const [saved, setSaved] = useState<SavedDeployment | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DeployProgress | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [bufferInput, setBufferInput] = useState("");
  const [signingMode, setSigningMode] = useState("small");
  const uploadBatchSize = !signAllTransactions || signingMode === "single" ? 1 : signingMode === "small" ? DEFAULT_UPLOAD_SIGNING_BATCH : MAX_UPLOAD_SIGNING_BATCH;
  const [receipt, setReceipt] = useState<string | null>(null);
  const inFlight = useRef(false);
  const artifact = useQuery({
    queryKey: ["admin-escrow-artifact"],
    enabled: allowed,
    queryFn: loadEscrowArtifact,
    staleTime: Infinity,
    retry: false,
  });
  const resumeBuffer = useMemo(() => {
    try {
      return saved?.buffer ? new PublicKey(saved.buffer) : undefined;
    } catch {
      return undefined;
    }
  }, [saved?.buffer]);
  const buffer = useQuery({
    queryKey: [
      "admin-deployment-buffer",
      saved?.buffer,
      artifact.data?.manifest.sha256,
    ],
    enabled: allowed && Boolean(resumeBuffer && artifact.data),
    queryFn: async () => {
      if (!await connection.getAccountInfo(resumeBuffer!, "confirmed")) return null;
      return inspectDeploymentBuffer(connection, resumeBuffer!, artifact.data!);
    },
    retry: false,
    refetchOnWindowFocus: true,
  });
  const configuredProgramId = ESCROW_PROGRAM_ID?.toBase58();
  const inspectedProgramId = saved?.programId || configuredProgramId;
  const existingProgram = useQuery({
    queryKey: [
      "admin-deployed-program",
      inspectedProgramId,
      artifact.data?.manifest.sha256,
    ],
    enabled: allowed && Boolean(inspectedProgramId && artifact.data),
    queryFn: () =>
      inspectDeployedProgram(
        connection,
        new PublicKey(inspectedProgramId!),
        artifact.data!,
      ),
    retry: false,
  });
  const inspectConfiguredSeparately = Boolean(configuredProgramId && inspectedProgramId !== configuredProgramId);
  const configuredProgram = useQuery({
    queryKey: ["admin-deployed-program", configuredProgramId, artifact.data?.manifest.sha256],
    enabled: allowed && Boolean(inspectConfiguredSeparately && artifact.data),
    queryFn: () => inspectDeployedProgram(connection, ESCROW_PROGRAM_ID!, artifact.data!),
    retry: false,
  });
  const savedProgramDeployed = Boolean(saved?.programId && existingProgram.data);
  const configuredProgramDeployed = Boolean(inspectConfiguredSeparately ? configuredProgram.data : configuredProgramId && existingProgram.data);
  const verifiedProgramId = configuredProgramDeployed ? configuredProgramId : existingProgram.data ? inspectedProgramId : undefined;
  const programDeployed = Boolean(verifiedProgramId);
  const deploymentWork = !programDeployed || Boolean(resumeBuffer && !savedProgramDeployed);
  const programInspectionReady = (!inspectedProgramId || existingProgram.isSuccess) && (!inspectConfiguredSeparately || configuredProgram.isSuccess);
  const deploymentInspectionReady = Boolean(resumeBuffer) || programInspectionReady;
  const quote = useQuery({
    queryKey: ["admin-deployment-quote", publicKey?.toBase58(), artifact.data?.manifest.sha256],
    enabled: allowed && Boolean(artifact.data && deploymentWork && deploymentInspectionReady),
    queryFn: () => quoteProgramDeployment(connection, ADMIN_WALLET, artifact.data!),
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  useEffect(() => {
    const stored = readSaved();
    setSaved(stored);
    if (stored?.programId || configuredProgramId) onProgramId(stored?.programId || configuredProgramId!);
    if (stored?.lastSignature) setReceipt(stored.lastSignature);
    const linkedBuffer = new URLSearchParams(window.location.search).get("buffer");
    if (linkedBuffer) {
      try { setBufferInput(new PublicKey(linkedBuffer).toBase58()); } catch { /* Ignore malformed public recovery links. */ }
    }
  }, [onProgramId, configuredProgramId]);
  useEffect(() => {
    currentAccess.current = allowed;
    return () => {
      currentAccess.current = false;
    };
  }, [allowed]);
  useEffect(() => {
    // A verified deployment may coexist with an unused funded buffer. Keep its refund path.
    if (!savedProgramDeployed || !saved?.programId || !saved.buffer || buffer.data !== null) return;
    const recovered = {
      sha256: saved.sha256,
      programId: saved.programId,
      signature: saved.signature,
    };
    setSaved(recovered);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recovered));
    } catch {
      /* Public recovery details remain visible even when storage is full. */
    }
    setMessage({
      ok: true,
      text: "The saved program is already deployed and its mainnet bytes match the verified artifact.",
    });
  }, [savedProgramDeployed, saved, buffer.data]);

  function remember(value: SavedDeployment | null) {
    setSaved(value);
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  }

  const sameArtifact =
    !saved?.buffer || saved.sha256 === artifact.data?.manifest.sha256;
  const remainingFees =
    quote.data && resumeBuffer && buffer.data
      ? quote.data.writeFeeLamports * BigInt(buffer.data.remainingChunks) +
        quote.data.deployFeeLamports
      : quote.data?.transactionFeesLamports;
  const requiredBalance =
    quote.data && resumeBuffer && buffer.data
      ? remainingDeploymentBalance(quote.data, buffer.data.lamports, buffer.data.remainingChunks)
      : quote.data?.requiredLamports;
  const sufficientBalance =
    quote.data && requiredBalance !== undefined
      ? quote.data.balanceLamports >= requiredBalance
      : false;
  const pendingRecovery = Boolean(bufferInput.trim() && !resumeBuffer);
  const balanceQuoteReady = Boolean(deploymentWork && deploymentInspectionReady && quote.data && !pendingRecovery && (!resumeBuffer || buffer.data));
  const remainingWrites = resumeBuffer && buffer.data ? buffer.data.remainingChunks : quote.data?.writeTransactions ?? 0;
  const uploadApprovals = Math.ceil(remainingWrites / uploadBatchSize);
  const currentGroupSize = busy && progress?.approvalTransactions
    ? progress.approvalTransactions
    : Math.min(remainingWrites, uploadBatchSize);
  const groupBaseFee = quote.data ? quote.data.writeFeeLamports * BigInt(currentGroupSize) : 0n;
  const groupMaximumFee = groupBaseFee + MAX_WALLET_PRIORITY_FEE_LAMPORTS * BigInt(currentGroupSize);
  const wallet = useMemo(
    () =>
      !publicKey || !signTransaction
        ? null
        : {
            publicKey,
            signTransaction: async (transaction: Transaction) => {
              if (!currentAccess.current)
                throw new Error(
                  "Unlock the dashboard with the admin wallet to continue this operation.",
                );
              try {
                return await signTransaction(transaction);
              } catch (error) {
                throw new DeploymentWalletApprovalError(error);
              }
            },
            ...(signAllTransactions
              ? {
                  signAllTransactions: async (transactions: Transaction[]) => {
                    if (!currentAccess.current)
                      throw new Error(
                        "Unlock the dashboard with the admin wallet to continue this operation.",
                      );
                    try {
                      return await signAllTransactions(transactions);
                    } catch (error) {
                      throw new DeploymentWalletApprovalError(error);
                    }
                  },
                }
              : {}),
          },
    [publicKey, signTransaction, signAllTransactions],
  );
  const ready =
    allowed &&
    Boolean(
      wallet &&
        artifact.data &&
        deploymentWork &&
        deploymentInspectionReady &&
        sufficientBalance &&
        !savedProgramDeployed &&
        (!programDeployed || resumeBuffer) &&
        sameArtifact &&
        (!bufferInput.trim() || resumeBuffer) &&
        (!resumeBuffer || buffer.data) &&
        (!saved?.buffer || !saved.programId || !existingProgram.isFetching),
    );

  async function deploy() {
    if (!ready || !wallet || !artifact.data || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    let latestProgress: DeployProgress | null = null;
    let record: SavedDeployment = {
      ...saved,
      sha256: artifact.data.manifest.sha256,
    };
    try {
      await authorize();
      // Verify storage before paying for an upload buffer. It stores only public account IDs.
      remember(record);
      const result = await deployEscrowProgram({
        connection,
        wallet,
        artifact: artifact.data,
        ...(resumeBuffer ? { resumeBuffer } : {}),
        maxDataLen: quote.data?.maxDataLen,
        writeBatchSize: uploadBatchSize,
        onTransaction: (signature) => {
          record = { ...record, lastSignature: signature };
          remember(record);
          setReceipt(signature);
        },
        onBufferCreated: (address) => {
          record = { ...record, buffer: address };
          remember(record);
        },
        onProgress: (next) => {
          if (!currentAccess.current)
            throw new Error(
              "The dashboard was locked. Unlock it to resume the saved upload.",
            );
          latestProgress = next;
          setProgress(next);
          if (next.programId || next.signature) {
            record = {
              ...record,
              ...(next.programId ? { programId: next.programId } : {}),
              ...(next.signature ? { signature: next.signature } : {}),
            };
            remember(record);
          }
        },
      });
      setReceipt(result.signature);
      queryClient.setQueryData(
        [
          "admin-deployed-program",
          result.programId,
          artifact.data.manifest.sha256,
        ],
        true,
      );
      remember({
        programId: result.programId,
        signature: result.signature,
        sha256: artifact.data.manifest.sha256,
      });
      onProgramId(result.programId);
      setMessage({
        ok: true,
        text: "Escrow program deployed. Validate its public program ID and verifier in the configuration panel.",
      });
    } catch (error) {
      const uploadApprovalFailed = error instanceof DeploymentWalletApprovalError
        && (latestProgress as DeployProgress | null)?.phase === "awaiting-upload-approval";
      setMessage({
        ok: false,
        text: error instanceof DeploymentWalletApprovalError
          ? `${error.message}${uploadApprovalFailed
            ? ` Completed writes remain saved in the funded buffer. ${uploadBatchSize > DEFAULT_UPLOAD_SIGNING_BATCH
              ? "Select Small batches and resume."
              : uploadBatchSize > 1
                ? "If the wallet continues to decline this group, select Compatibility and resume."
                : "Check the wallet's message before retrying this write."} A write group requires only its network fees; it does not fund another buffer.`
            : ""}`
          : errorMessage(error),
      });
    } finally {
      setBusy(false);
      inFlight.current = false;
      await queryClient.invalidateQueries({
        queryKey: ["admin-deployment-buffer"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["admin-deployed-program"],
      });
      await quote.refetch();
    }
  }

  async function recoverBuffer() {
    if (!allowed || !artifact.data || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const address = new PublicKey(bufferInput.trim());
      if (saved?.buffer && saved.buffer !== address.toBase58()) throw new Error("Resolve the current saved buffer before switching to another upload.");
      const inspected = await inspectDeploymentBuffer(connection, address, artifact.data);
      if (!currentAccess.current) throw new Error("Unlock the admin dashboard to restore the upload.");
      remember({ ...saved, buffer: address.toBase58(), sha256: artifact.data.manifest.sha256 });
      queryClient.setQueryData(["admin-deployment-buffer", address.toBase58(), artifact.data.manifest.sha256], inspected);
      setProgress(null);
      setMessage({ ok: true, text: "Existing buffer verified and restored. Resume uses the SOL already in this buffer; no new upload account is funded." });
      await quote.refetch();
    } catch (error) {
      setMessage({ ok: false, text: errorMessage(error) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function refundBuffer() {
    if (!allowed || !wallet || !resumeBuffer || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await authorize();
      const signature = await closeDeploymentBuffer({
        connection,
        wallet,
        buffer: resumeBuffer,
      });
      setReceipt(signature);
      if (saved?.programId)
        remember({
          sha256: saved.sha256,
          programId: saved.programId,
          signature: saved.signature,
        });
      else remember(null);
      setProgress(null);
      setMessage({
        ok: true,
        text: "Upload buffer closed. Its remaining SOL rent was returned to the admin wallet.",
      });
      await quote.refetch();
    } catch (error) {
      setMessage({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  if (!allowed) return null;
  const deployedReceipt = verifiedProgramId === deployment.programId && artifact.data?.manifest.sha256 === deployment.artifactSha256
    ? deployment.deploySignature
    : verifiedProgramId === saved?.programId ? saved?.signature : undefined;
  return (
    <section className="editorial-panel p-5 sm:p-6">
      <div className="edition-label">02 / Escrow program</div>
      <h2 className="editorial mt-2 text-[34px] leading-none">
        {programDeployed ? "Verified on mainnet." : "A real mainnet program."}
      </h2>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        {programDeployed ? "Your escrow program is deployed and its on-chain bytes match the verified build. No new deployment funding is needed. Upgrade authority stays with your admin wallet." : <>The verified build is uploaded to a Solana buffer, checked, then
        deployed with your admin wallet as upgrade authority. You approve each
        wallet transaction in this workflow. Upgrade authority stays with you;
        this panel does not renounce it.</>}
      </p>
      {programDeployed ? (
        <div role="status" className="mt-5 border border-neon bg-card-2 p-4">
          <div className="edition-label text-neon">Escrow ready</div>
          <a className="mt-2 block break-all font-mono text-[11px] text-neon hover:underline" href={`https://solscan.io/account/${verifiedProgramId}`} target="_blank" rel="noreferrer">{verifiedProgramId} ↗</a>
          {deployedReceipt ? <a className="mt-3 inline-block text-[12px] text-neon hover:underline" href={`https://solscan.io/tx/${deployedReceipt}`} target="_blank" rel="noreferrer">View deployment receipt ↗</a> : null}
          {resumeBuffer ? <p className="mt-3 text-[12px] text-ink-2">A separate upload buffer is saved below. Its refund remains available.</p> : null}
        </div>
      ) : inspectedProgramId && !programInspectionReady ? (
        <div className="mt-5 border border-line p-4">
          <p role={existingProgram.error || configuredProgram.error ? "alert" : "status"} className="text-[12px] text-ink-2">{existingProgram.error || configuredProgram.error ? "The existing program could not be verified. New deployment is paused until its mainnet status is confirmed." : "Checking the existing program on Solana mainnet before offering deployment…"}</p>
          {existingProgram.error || configuredProgram.error ? <button className="btn-secondary mt-3 px-3 py-2 text-[12px]" disabled={busy} onClick={() => { void existingProgram.refetch(); if (inspectConfiguredSeparately) void configuredProgram.refetch(); }}>Refresh program status</button> : null}
        </div>
      ) : null}
      {artifact.isLoading ? (
        <p className="mt-5 text-[13px] text-ink-3">
          Loading and verifying the escrow artifact…
        </p>
      ) : artifact.error ? (
        <p role="alert" className="mt-5 text-[13px] text-down-ink">
          {errorMessage(artifact.error)}
        </p>
      ) : artifact.data ? (
        <div className="mt-5 grid gap-3 border-y border-line py-4 sm:grid-cols-2">
          <div>
            <div className="eyebrow">Verified binary</div>
            <div className="mt-1 font-mono text-[13px]">
              {artifact.data.bytes.length.toLocaleString()} bytes
            </div>
          </div>
          <div>
            <div className="eyebrow">SHA-256</div>
            <div className="mt-1 break-all font-mono text-[10px] text-ink-2">
              {artifact.data.manifest.sha256}
            </div>
          </div>
        </div>
      ) : null}
      {deploymentWork && quote.isFetching ? (
        <p className="mt-4 text-[12px] text-ink-3">
          Reading mainnet deployment costs and wallet balance…
        </p>
      ) : null}
      {deploymentWork && quote.error ? (
        <p role="alert" className="mt-4 text-[13px] text-down-ink">
          {errorMessage(quote.error)}
        </p>
      ) : quote.data && balanceQuoteReady ? (
        <dl className="mt-5 space-y-3 text-[13px]">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-2">Wallet balance</dt>
            <dd className="font-mono">
              {formatSol(quote.data.balanceLamports, 5)} SOL
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-2">{resumeBuffer && buffer.data ? "Already funded in this buffer" : "Rent held by the deployed program"}</dt>
            <dd className="font-mono">
              {formatSol(resumeBuffer && buffer.data ? buffer.data.lamports : quote.data.lockedRentLamports, 6)} SOL
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-2">{resumeBuffer ? "Remaining estimated network fees" : "Estimated network fees"}</dt>
            <dd className="font-mono">
              {formatSol(
                remainingFees ?? quote.data.transactionFeesLamports,
                6,
              )}{" "}
              SOL
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-2">Maximum wallet priority-fee reserve</dt>
            <dd className="font-mono">{formatSol(resumeBuffer && buffer.data ? MAX_WALLET_PRIORITY_FEE_LAMPORTS * BigInt(buffer.data.remainingChunks + 2) : quote.data.walletFeeReserveLamports, 6)} SOL</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line pt-3">
            <dt className="font-semibold">{resumeBuffer ? "Additional wallet balance needed" : "Required SOL balance"}</dt>
            <dd className="font-mono font-semibold text-neon">
              {formatSol(requiredBalance ?? quote.data.requiredLamports, 6)} SOL
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-3">Upload and deployment transactions</dt>
            <dd>
              {resumeBuffer && buffer.data
                ? buffer.data.remainingChunks + 1
                : quote.data.totalTransactions}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-2">Upload approval groups</dt>
            <dd className="font-mono text-neon">{uploadApprovals}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-2">Other wallet approval requests</dt>
            <dd className="text-right">{resumeBuffer ? "1 final deployment" : "Buffer creation + final deployment"}</dd>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-3">
            {resumeBuffer && buffer.data
              ? "Your existing buffer funding will be reused for program rent. The additional balance above covers only the remaining work and a small wallet and recovery reserve."
              : `Upload funding is reused for program rent. The full workflow's estimated final cost is ${formatSol(quote.data.finalCostLamports, 6)} SOL.`}{" "}
            Wallet-added priority fees are capped at 0.000005 SOL per transaction. The required balance includes their maximum allowance; unused allowance stays in your wallet.
          </p>
        </dl>
      ) : null}
      {pendingRecovery ? (
        <p role="status" className="mt-4 text-[13px] text-ink-2">
          Restore the existing buffer below to calculate only the remaining cost. Its funded SOL will count toward deployment.
        </p>
      ) : null}
      {!resumeBuffer ? (
        <details className="mt-5 border border-line p-4" open={Boolean(bufferInput)}>
          <summary className="cursor-pointer text-[13px] font-semibold">Recover an existing upload</summary>
          <p className="mt-3 text-[12px] text-ink-2">Already paid for a buffer? Restore its public address before deploying. This check does not send a transaction.</p>
          <label htmlFor="deployment-buffer" className="mt-3 block text-[12px]">Existing buffer address</label>
          <input id="deployment-buffer" value={bufferInput} onChange={(event) => setBufferInput(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} className="mt-2 w-full rounded border border-line bg-card-2 px-3 py-2 font-mono text-[11px]" />
          <button className="btn-secondary mt-3 px-3 py-2 text-[12px]" disabled={busy || !artifact.data || !bufferInput.trim()} onClick={() => { void recoverBuffer(); }}>Check and restore buffer</button>
        </details>
      ) : null}
      {deploymentWork ? <div className="mt-5 border border-line p-4">
        <label htmlFor="upload-signing-mode" className="block text-[13px] font-semibold">Upload approvals</label>
        <select id="upload-signing-mode" value={signAllTransactions ? signingMode : "single"} onChange={(event) => setSigningMode(event.target.value)} disabled={busy || !signAllTransactions} className="mt-2 w-full rounded border border-line bg-card-2 px-3 py-2 text-[12px]">
          <option value="small">Small batches — up to {DEFAULT_UPLOAD_SIGNING_BATCH} writes per request (recommended)</option>
          <option value="fast">Full batch — all remaining writes (optional)</option>
          <option value="single">Compatibility — one write per request</option>
        </select>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
          {uploadBatchSize > 1
            ? `Up to ${uploadBatchSize} writes are requested together. After each approval, the site sends that group and prepares the next. Your wallet controls the confirmation screens within each request.`
            : "This mode requests a separate wallet approval for each write and sends it immediately."}{" "}
          The first write in each group is simulated before approval. Final deployment has its own approval. Keep this tab open until the upload finishes.
        </p>
        {signingMode === "fast" && signAllTransactions ? (
          <p className="mt-2 text-[12px] text-ink-2">Full batches may exceed a mobile wallet&apos;s request limit. Use Small batches if your wallet declines the request.</p>
        ) : null}
        {balanceQuoteReady && currentGroupSize > 0 ? (
          <div className="mt-3 border-t border-line pt-3 text-[12px]">
            <p className="font-semibold">{busy ? "Current" : "Next"} upload group: {currentGroupSize} writes</p>
            <p className="mt-1 text-ink-2">Estimated network fees: {formatSol(groupBaseFee, 9)} SOL. Upper bound with wallet priority fees: {formatSol(groupMaximumFee, 9)} SOL.</p>
            <p className="mt-1 text-ink-2">Upload writes reuse the funded buffer; they do not pay rent again.</p>
          </div>
        ) : null}
      </div> : null}
      {resumeBuffer ? (
        <div className="mt-5 border border-line bg-card-2 p-4">
          <div className="edition-label">Interrupted upload</div>
          <a
            className="mt-2 block break-all font-mono text-[11px] text-neon hover:underline"
            href={`https://solscan.io/account/${resumeBuffer.toBase58()}`}
            target="_blank"
            rel="noreferrer"
          >
            {resumeBuffer.toBase58()} ↗
          </a>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
            {!sameArtifact
              ? "This buffer belongs to a different artifact. Close it to recover rent before deploying the current build."
              : buffer.data
                ? `${buffer.data.writtenBytes.toLocaleString()} / ${artifact.data?.bytes.length.toLocaleString()} bytes verified. ${buffer.data.remainingChunks} chunks remain.`
                : buffer.error
                  ? errorMessage(buffer.error)
                  : "Checking this buffer's owner, authority and uploaded bytes…"}
          </p>
          {buffer.data ? <p className="mt-2 text-[12px] text-ink-2">
            Refundable upload balance: {formatSol(buffer.data.lamports, 6)} SOL,
            minus the network fee. The refund goes only to the admin wallet.
          </p> : null}
          <button
            className="btn-secondary mt-3 px-3 py-2 text-[12px]"
            disabled={busy || !wallet}
            onClick={() => {
              void refundBuffer();
            }}
          >
            Close buffer and recover its rent
          </button>
        </div>
      ) : null}
      {saved?.programId ? (
        <div className="mt-5 text-[12px]">
          <span className="text-ink-3">Saved public program ID</span>
          <a
            className="mt-1 block break-all font-mono text-neon hover:underline"
            href={`https://solscan.io/account/${saved.programId}`}
            target="_blank"
            rel="noreferrer"
          >
            {saved.programId} ↗
          </a>
        </div>
      ) : null}
      {deploymentWork && progress ? (
        <div aria-live="polite" className="mt-5">
          <div className="flex justify-between gap-4 text-[12px]">
            <span className="uppercase tracking-wider text-neon">
              {progress.phase.replaceAll("-", " ")}
            </span>
            <span className="font-mono text-ink-3">
              {progress.writtenBytes.toLocaleString()} /{" "}
              {progress.totalBytes.toLocaleString()} bytes
            </span>
          </div>
          <progress
            className="mt-3 h-2 w-full accent-[var(--lime)]"
            max={progress.totalBytes || 1}
            value={progress.writtenBytes}
          />
          {progress.approvalBatch && progress.approvalBatches && progress.approvalTransactions ? (
            <p className="mt-2 text-[12px] text-ink-2">
              Upload group {progress.approvalBatch} of {progress.approvalBatches}: {progress.approvalTransactions} writes.
              {progress.phase === "awaiting-upload-approval" ? " Waiting for your wallet approval." : " Sending approved writes and checking confirmations."}
            </p>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`mt-4 p-3 text-[13px] ${message.ok ? "bg-up-soft text-up-ink" : "bg-down-soft text-down-ink"}`}
        >
          {message.text}
        </p>
      ) : null}
      {receipt || saved?.signature ? (
        <a
          className="mt-4 inline-block font-mono text-[11px] text-neon hover:underline"
          href={`https://solscan.io/tx/${receipt || saved?.signature}`}
          target="_blank"
          rel="noreferrer"
        >
          Check last transaction status ↗
        </a>
      ) : null}
      {quote.data && balanceQuoteReady && requiredBalance !== undefined && !sufficientBalance ? (
        <p className="mt-4 text-[12px] text-down-ink">
          {shortAddress(ADMIN_WALLET.toBase58())} needs {formatSol(requiredBalance - quote.data.balanceLamports, 6)} SOL more to cover this estimate.
          {resumeBuffer ? " Existing buffer funding is already included." : ""}
        </p>
      ) : null}
      {deploymentWork && !wallet ? (
        <p className="mt-4 text-[12px] text-down-ink">
          This wallet must support Solana transaction signing to deploy.
        </p>
      ) : null}
      {deploymentWork ? <div className="mt-5 flex flex-wrap gap-3">
        <button
          className="btn-primary flex-1 px-4 py-3.5 text-[14px]"
          disabled={!ready || busy}
          onClick={() => {
            void deploy();
          }}
        >
          {busy
            ? "Deployment in progress…"
            : savedProgramDeployed
              ? "Verified program is already deployed"
              : resumeBuffer
                ? uploadBatchSize > 1 ? "Resume with batch signing →" : "Resume the verified upload →"
                : "Deploy escrow on mainnet →"}
        </button>
        <button
          className="btn-secondary px-4 py-3 text-[13px]"
          disabled={busy || !artifact.data}
          onClick={() => {
            void quote.refetch();
          }}
        >
          Refresh cost
        </button>
      </div> : null}
      <ProgramRentRecovery wallet={wallet} artifact={artifact.data} authorize={authorize} onBusyChange={setBusy} disabled={busy}
        onClosed={(programId) => {
          if (saved?.programId === programId) { remember(null); onProgramId(""); }
          void quote.refetch();
          void queryClient.invalidateQueries({ queryKey: ["admin-deployed-program"] });
        }} />
    </section>
  );
}
