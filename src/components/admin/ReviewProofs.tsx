"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ADMIN_WALLET, MAINNET_GENESIS_HASH } from "@/lib/admin-config";
import { errorMessage } from "@/lib/format";
import { useEscrowAvailability } from "@/lib/hooks";
import {
  approveCreatorProofInstruction,
  creatorProofHash,
  listCreatorProofs,
  proofChallenge,
  type CreatorProof,
} from "@/lib/solana/creator-proof";
import { assertTikTokEscrowDeployed } from "@/lib/solana/pump";
import { isTikTokLaunchReady, tikTokProfileUrl, VERIFIER } from "@/lib/tiktok-config";
import { checkedVersionedSignature } from "@/lib/solana/versioned-signing";
import { sendCheckedVersionedTransaction, VersionedTransactionFailedError, VersionedTransactionPreflightError } from "@/lib/solana/versioned-send";

type Receipt = {
  signature: string;
  handle: string;
  state: "pending" | "confirmed" | "failed" | "rejected";
};

function evidenceKey(proof: CreatorProof): string {
  return [
    proof.account,
    proof.handle,
    proof.beneficiary.toBase58(),
    proofChallenge(proof),
    proof.videoId ?? "",
    proof.expiresAt.toString(),
  ].join(":");
}

function expiryLabel(expiresAt: bigint): string {
  const milliseconds = Number(expiresAt) * 1_000;
  if (!Number.isSafeInteger(milliseconds)) return "Expiry unavailable";
  return new Date(milliseconds).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function ReviewProofs({
  enabled,
  authorize,
}: {
  enabled: boolean;
  authorize: () => Promise<void>;
}) {
  const { connection } = useConnection();
  const { connected, publicKey, signTransaction } = useWallet();
  const address = publicKey?.toBase58();
  const authorized = Boolean(enabled && connected && publicKey?.equals(ADMIN_WALLET));
  const configured = isTikTokLaunchReady();
  const escrow = useEscrowAvailability();
  const verifierMatches = Boolean(VERIFIER?.equals(ADMIN_WALLET));
  const active = authorized && configured && escrow.available;
  const access = useRef({ active, address, verifierMatches, endpoint: connection.rpcEndpoint });
  access.current = { active, address, verifierMatches, endpoint: connection.rpcEndpoint };
  const inFlight = useRef(false);
  const [checked, setChecked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<{ account: string; text: string } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setChecked({});
    setMessage(null);
    setReceipts([]);
  }, [address]);

  useEffect(() => () => {
    access.current.active = false;
  }, []);

  const queue = useQuery({
    queryKey: ["admin-creator-proofs", address, connection.rpcEndpoint, VERIFIER?.toBase58()],
    enabled: active,
    retry: false,
    refetchInterval: active ? 15_000 : false,
    queryFn: async () => {
      if ((await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH) {
        throw new Error("Creator proof requests must be read from Solana mainnet.");
      }
      return listCreatorProofs(connection);
    },
  });
  const proofs = active && !queue.isError ? queue.data : undefined;
  const { refetch: refetchQueue } = queue;
  const expired = (proof: CreatorProof) => proof.expired || proof.expiresAt <= BigInt(Math.floor(now / 1_000));

  function assertAccess() {
    if (
      !access.current.active ||
      !access.current.verifierMatches ||
      access.current.address !== ADMIN_WALLET.toBase58() ||
      access.current.endpoint !== connection.rpcEndpoint ||
      !publicKey?.equals(ADMIN_WALLET)
    ) {
      throw new Error("Authenticate the configured admin and verification wallet before approving a request.");
    }
  }

  function updateReceipt(signature: string, state: Receipt["state"]) {
    setReceipts((current) => current.map((receipt) => receipt.signature === signature ? { ...receipt, state } : receipt));
  }

  const pendingSignatures = receipts.filter((receipt) => receipt.state === "pending").map((receipt) => receipt.signature).join(",");
  useEffect(() => {
    if (!authorized || !pendingSignatures) return;
    let cancelled = false;
    const signatures = pendingSignatures.split(",");
    const poll = async () => {
      try {
        const result = await connection.getSignatureStatuses(signatures, { searchTransactionHistory: true });
        if (cancelled) return;
        result.value.forEach((status, index) => {
          if (status?.err) updateReceipt(signatures[index], "failed");
          else if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
            updateReceipt(signatures[index], "confirmed");
            void refetchQueue();
          }
        });
      } catch {
        // A failed status read leaves the receipt pending until Solana confirms it.
      }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 5_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [authorized, connection, pendingSignatures, refetchQueue]);

  async function approve(proof: CreatorProof) {
    if (!active || inFlight.current || !publicKey || !signTransaction) return;
    const reviewedEvidence = evidenceKey(proof);
    if (checked[proof.account] !== reviewedEvidence || !proof.videoId) return;
    inFlight.current = true;
    setMessage(null);
    let signature: string | null = null;
    try {
      const reviewedHash = await creatorProofHash(proof);
      setBusy({ account: proof.account, text: "Checking the admin session and deployed mainnet program…" });
      await escrow.assertAvailable();
      assertAccess();
      if ((await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH) {
        throw new Error("Connect to Solana mainnet before approving creator proofs.");
      }
      await assertTikTokEscrowDeployed(connection);
      assertAccess();
      await authorize();
      assertAccess();
      const refreshed = await queue.refetch();
      if (refreshed.error || !refreshed.data) throw refreshed.error || new Error("The review queue could not be refreshed.");
      const current = refreshed.data.find((request) => request.account === proof.account);
      if (!current) throw new Error("This request is no longer pending on Solana. Refresh the queue.");
      const currentHash = await creatorProofHash(current);
      if (evidenceKey(current) !== reviewedEvidence || !Buffer.from(currentHash).equals(Buffer.from(reviewedHash))) {
        throw new Error("This request changed. Review its current video and caption before approving.");
      }
      if (current.expired || current.expiresAt <= BigInt(Math.floor(Date.now() / 1_000))) {
        throw new Error("This 48-hour request expired. The creator must submit a new proof.");
      }
      assertAccess();
      const lifetime = await connection.getLatestBlockhash("confirmed");
      const transaction = new VersionedTransaction(new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: lifetime.blockhash,
        instructions: [approveCreatorProofInstruction(current.handle, current.beneficiary, reviewedHash)],
      }).compileToV0Message());
      const expectedMessage = transaction.message.serialize();
      await assertTikTokEscrowDeployed(connection);
      assertAccess();
      setBusy({ account: proof.account, text: "Sign the creator proof approval in your admin wallet…" });
      const signed = await checkedVersionedSignature(expectedMessage, await signTransaction(transaction));
      await assertTikTokEscrowDeployed(connection);
      assertAccess();
      setBusy({ account: proof.account, text: "Sending the approval to Solana mainnet…" });
      signature = await sendCheckedVersionedTransaction(connection, signed, (id) => {
        signature = id;
        setReceipts((currentReceipts) => [...currentReceipts, { signature: id, handle: current.handle, state: "pending" }]);
        setBusy({ account: proof.account, text: "Waiting for the on-chain approval receipt…" });
      });
      updateReceipt(signature, "confirmed");
      setChecked((previous) => { const next = { ...previous }; delete next[proof.account]; return next; });
      setMessage({ ok: true, text: `@${current.handle}'s proof was approved on Solana. The creator must activate it with the requesting wallet before withdrawing fees.` });
    } catch (error) {
      if (error instanceof VersionedTransactionFailedError) updateReceipt(error.signature, "failed");
      if (error instanceof VersionedTransactionPreflightError) updateReceipt(error.signature, "rejected");
      setMessage({ ok: false, text: `${errorMessage(error)}${signature ? " Check the transaction receipt before submitting another approval." : ""}` });
    } finally {
      inFlight.current = false;
      setBusy(null);
      if (access.current.active) await queue.refetch();
    }
  }

  return (
    <section className="editorial-panel overflow-hidden" aria-labelledby="review-proofs-heading">
      <div className="flex flex-wrap items-start justify-between gap-5 border-b border-line p-5 sm:p-6">
        <div>
          <div className="edition-label">Creator ownership / Manual review</div>
          <h2 id="review-proofs-heading" className="editorial mt-2 text-[34px] leading-none">Review creator proofs.</h2>
          <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-ink-2">
            Open the original TikTok video and check its actual video author. The URL path alone is insufficient. Confirm the exact full request code in the public caption; screenshots and reposts are not proof. Each request is signed by the beneficiary wallet and expires after 48 hours.
          </p>
        </div>
        <button className="btn-secondary px-3 py-2 text-[12px]" disabled={!active || queue.isFetching || Boolean(busy)} onClick={() => { void queue.refetch(); }}>
          {queue.isFetching ? "Reading requests…" : "Refresh requests"}
        </button>
      </div>

      {!authorized ? (
        <p className="p-5 text-[13px] text-ink-3">Authenticate the configured admin wallet to review creator proofs.</p>
      ) : !configured ? (
        <p className="p-5 text-[13px] leading-relaxed text-ink-3">The mainnet escrow program and verification authority must be configured before requests can be read.</p>
      ) : !escrow.available ? (
        <p role="status" className="p-5 text-[13px] leading-relaxed text-ink-3">{escrow.pausedMessage}</p>
      ) : queue.isLoading ? (
        <p role="status" className="p-5 text-[13px] text-ink-3">Reading signed proof requests directly from Solana mainnet…</p>
      ) : queue.error ? (
        <div className="p-5">
          <p role="alert" className="text-[13px] text-down-ink">{errorMessage(queue.error)}</p>
          <p className="mt-2 text-[11px] text-ink-3">The review queue is unavailable until its on-chain accounts can be read.</p>
        </div>
      ) : proofs && !proofs.length ? (
        <p className="p-5 text-[13px] text-ink-3">No pending creator proof requests were found on Solana mainnet.</p>
      ) : proofs ? (
        <div className="divide-y divide-line">
          {proofs.map((proof) => {
            const isExpired = expired(proof);
            const code = proofChallenge(proof);
            const videoUrl = proof.videoId ? `${tikTokProfileUrl(proof.handle)}/video/${proof.videoId}` : null;
            const reviewed = checked[proof.account] === evidenceKey(proof);
            return (
              <article key={proof.account} className="p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <a href={tikTokProfileUrl(proof.handle)} target="_blank" rel="noreferrer" className="text-[18px] font-semibold hover:text-neon">@{proof.handle} ↗</a>
                    <p className="mt-1 text-[11px] text-ink-3">{isExpired ? "Expired" : videoUrl ? "Awaiting caption review" : "Waiting for the creator to attach a video"} · {expiryLabel(proof.expiresAt)}</p>
                  </div>
                  <a href={`https://solscan.io/account/${proof.account}`} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-ink-3 hover:text-neon">On-chain request ↗</a>
                </div>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="edition-label text-ink-3">Beneficiary wallet</dt>
                    <dd className="mt-2 break-all font-mono text-[11px] text-ink-2">{proof.beneficiary.toBase58()}</dd>
                  </div>
                  <div>
                    <dt className="edition-label text-ink-3">Exact caption code</dt>
                    <dd className="mt-2 break-all font-mono text-[12px] text-neon">{code}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="edition-label text-ink-3">Original TikTok video</dt>
                    <dd className="mt-2 break-all text-[12px]">
                      {videoUrl ? <a href={videoUrl} target="_blank" rel="noreferrer" className="text-neon hover:underline">{videoUrl} ↗</a> : <span className="text-ink-3">No video attached on-chain.</span>}
                    </dd>
                  </div>
                </dl>
                <label className="mt-5 flex cursor-pointer items-start gap-3 text-[12px] leading-relaxed text-ink-2">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-neon" checked={reviewed} disabled={!videoUrl || isExpired || !verifierMatches || Boolean(busy)} onChange={(event) => {
                    const confirmed = event.target.checked;
                    setChecked((previous) => { const next = { ...previous }; if (confirmed) next[proof.account] = evidenceKey(proof); else delete next[proof.account]; return next; });
                  }} />
                  <span>I opened the original public video, checked that its actual video author is @{proof.handle}, and saw this exact full code in the original caption, not a screenshot or repost: <span className="break-all font-mono text-neon">{code}</span>.</span>
                </label>
                <button className="btn-primary mt-4 w-full sm:w-auto" disabled={!active || !verifierMatches || !signTransaction || !reviewed || !videoUrl || isExpired || Boolean(busy) || queue.isError} onClick={() => { void approve(proof); }}>
                  {busy?.account === proof.account ? "Approval in progress…" : isExpired ? "Request expired" : "Approve creator proof →"}
                </button>
              </article>
            );
          })}
        </div>
      ) : null}

      <div className="space-y-3 border-t border-line p-5 sm:p-6">
        {authorized && configured && !verifierMatches ? <p role="alert" className="text-[12px] text-down-ink">The configured verification authority differs from the admin wallet. This wallet cannot approve creator requests.</p> : null}
        <p className="text-[11px] leading-relaxed text-ink-3">Approval records the verified creator wallet on-chain. The beneficiary activates the approval and controls withdrawals. The admin wallet pays the approval transaction fee.</p>
        {busy ? <p role="status" aria-live="polite" className="text-[12px] text-neon">{busy.text}</p> : null}
        {message && authorized ? <p role={message.ok ? "status" : "alert"} className={`p-3 text-[12px] ${message.ok ? "bg-up-soft text-up-ink" : "bg-down-soft text-down-ink"}`}>{message.text}</p> : null}
        {receipts.length && authorized ? <div className="flex flex-wrap gap-x-4 gap-y-2">{receipts.map((receipt) => <a key={receipt.signature} href={`https://solscan.io/tx/${receipt.signature}`} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-neon hover:underline">@{receipt.handle} · {receipt.state} ↗</a>)}</div> : null}
      </div>
    </section>
  );
}
