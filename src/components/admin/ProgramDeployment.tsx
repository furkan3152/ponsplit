"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, type Transaction } from "@solana/web3.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ADMIN_WALLET } from "@/lib/admin-config";
import { errorMessage, formatSol, shortAddress } from "@/lib/format";
import {
  closeDeploymentBuffer,
  deployEscrowProgram,
  inspectDeployedProgram,
  inspectDeploymentBuffer,
  loadEscrowArtifact,
  quoteProgramDeployment,
  remainingDeploymentBalance,
  type DeployProgress,
} from "@/lib/solana/program-deploy";

const STORAGE_KEY = "tiksplit:admin-deployment:v1";
type SavedDeployment = {
  buffer?: string;
  programId?: string;
  signature?: string;
  sha256: string;
};

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
  const [receipt, setReceipt] = useState<string | null>(null);
  const inFlight = useRef(false);
  const artifact = useQuery({
    queryKey: ["admin-escrow-artifact"],
    enabled: allowed,
    queryFn: loadEscrowArtifact,
    staleTime: Infinity,
    retry: false,
  });
  const quote = useQuery({
    queryKey: [
      "admin-deployment-quote",
      publicKey?.toBase58(),
      artifact.data?.manifest.sha256,
    ],
    enabled: allowed && Boolean(artifact.data),
    queryFn: () =>
      quoteProgramDeployment(connection, ADMIN_WALLET, artifact.data!),
    staleTime: 20_000,
    refetchOnWindowFocus: true,
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
    queryFn: () =>
      inspectDeploymentBuffer(connection, resumeBuffer!, artifact.data!),
    retry: false,
    refetchOnWindowFocus: true,
  });
  const existingProgram = useQuery({
    queryKey: [
      "admin-deployed-program",
      saved?.programId,
      artifact.data?.manifest.sha256,
    ],
    enabled: allowed && Boolean(saved?.programId && artifact.data),
    queryFn: () =>
      inspectDeployedProgram(
        connection,
        new PublicKey(saved!.programId!),
        artifact.data!,
      ),
    retry: false,
  });
  useEffect(() => {
    const stored = readSaved();
    setSaved(stored);
    if (stored?.programId) onProgramId(stored.programId);
  }, [onProgramId]);
  useEffect(() => {
    currentAccess.current = allowed;
    return () => {
      currentAccess.current = false;
    };
  }, [allowed]);
  useEffect(() => {
    if (!existingProgram.data || !saved?.programId || !saved.buffer) return;
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
  }, [existingProgram.data, saved]);

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
  const wallet = useMemo(
    () =>
      !publicKey || !signTransaction
        ? null
        : {
            publicKey,
            signTransaction: (transaction: Transaction) => {
              if (!currentAccess.current)
                throw new Error(
                  "Unlock the dashboard with the admin wallet to continue this upload.",
                );
              return signTransaction(transaction);
            },
            ...(signAllTransactions
              ? {
                  signAllTransactions: (transactions: Transaction[]) => {
                    if (!currentAccess.current)
                      throw new Error(
                        "Unlock the dashboard with the admin wallet to continue this upload.",
                      );
                    return signAllTransactions(transactions);
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
        sufficientBalance &&
        !existingProgram.data &&
        sameArtifact &&
        (!resumeBuffer || buffer.data) &&
        (!saved?.buffer || !saved.programId || !existingProgram.isFetching),
    );

  async function deploy() {
    if (!ready || !wallet || !artifact.data || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
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
        onBufferCreated: (address) => {
          record = { ...record, buffer: address };
          remember(record);
        },
        onProgress: (next) => {
          if (!currentAccess.current)
            throw new Error(
              "The dashboard was locked. Unlock it to resume the saved upload.",
            );
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
      setMessage({ ok: false, text: errorMessage(error) });
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
  return (
    <section className="editorial-panel p-5 sm:p-6">
      <div className="edition-label">02 / Deploy the escrow</div>
      <h2 className="editorial mt-2 text-[34px] leading-none">
        A real mainnet program.
      </h2>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        The verified build is uploaded to a Solana buffer, checked, then
        deployed with your admin wallet as upgrade authority. You approve each
        wallet transaction in this workflow.
      </p>
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
      {quote.isFetching ? (
        <p className="mt-4 text-[12px] text-ink-3">
          Reading mainnet deployment costs and wallet balance…
        </p>
      ) : null}
      {quote.error ? (
        <p role="alert" className="mt-4 text-[13px] text-down-ink">
          {errorMessage(quote.error)}
        </p>
      ) : quote.data ? (
        <dl className="mt-5 space-y-3 text-[13px]">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-2">Wallet balance</dt>
            <dd className="font-mono">
              {formatSol(quote.data.balanceLamports, 5)} SOL
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-2">Rent remaining in deployed accounts</dt>
            <dd className="font-mono">
              {formatSol(quote.data.lockedRentLamports, 5)} SOL
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-2">Estimated transaction fees</dt>
            <dd className="font-mono">
              {formatSol(
                remainingFees ?? quote.data.transactionFeesLamports,
                5,
              )}{" "}
              SOL
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line pt-3">
            <dt className="font-semibold">Required SOL balance</dt>
            <dd className="font-mono font-semibold text-neon">
              {formatSol(requiredBalance ?? quote.data.requiredLamports, 5)} SOL
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
          <p className="text-[11px] leading-relaxed text-ink-3">
            {resumeBuffer && buffer.data
              ? "SOL already in the upload buffer is credited toward deployment. This is the additional wallet balance needed."
              : "Upload SOL is reused to fund the deployed program, so it is counted once. A small wallet and recovery reserve is included."}{" "}
            The full workflow&apos;s final estimated cost is{" "}
            {formatSol(quote.data.finalCostLamports, 5)} SOL. Buffer funding becomes program rent; any surplus is returned.
          </p>
        </dl>
      ) : null}
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
      {progress ? (
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
          View deployment transaction ↗
        </a>
      ) : null}
      {quote.data && !sufficientBalance ? (
        <p className="mt-4 text-[12px] text-down-ink">
          Fund {shortAddress(ADMIN_WALLET.toBase58())} with enough SOL for the
          required balance before deploying.
        </p>
      ) : null}
      {!wallet ? (
        <p className="mt-4 text-[12px] text-down-ink">
          This wallet must support Solana transaction signing to deploy.
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          className="btn-primary flex-1 px-4 py-3.5 text-[14px]"
          disabled={!ready || busy}
          onClick={() => {
            void deploy();
          }}
        >
          {busy
            ? "Deployment in progress…"
            : existingProgram.data
              ? "Verified program is already deployed"
              : resumeBuffer
                ? "Resume the verified upload →"
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
      </div>
    </section>
  );
}
