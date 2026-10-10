"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ADMIN_WALLET, MAINNET_GENESIS_HASH } from "@/lib/admin-config";
import { errorMessage, formatSol, shortAddress } from "@/lib/format";
import { useEscrowAvailability } from "@/lib/hooks";
import {
  isTikTokLaunchReady,
  tikTokProfileUrl,
  VERIFIER,
} from "@/lib/tiktok-config";
import { assertTikTokEscrowDeployed } from "@/lib/solana/pump";
import {
  activateCreatorInstruction,
  creatorVaultClaimable,
  initCreatorVaultInstruction,
  CREATOR_VAULT_SIZE,
} from "@/lib/solana/tiktok-escrow";
import {
  attachCreatorProofVideoInstruction,
  cancelCreatorProofInstruction,
  generateCreatorProofNonce,
  parseTikTokProofVideo,
  proofChallenge,
  readCreatorProof,
  requestCreatorProofInstruction,
  CREATOR_PROOF_SIZE,
} from "@/lib/solana/creator-proof";
import { checkedVersionedSignature } from "@/lib/solana/versioned-signing";
import { sendCheckedVersionedTransaction, VersionedTransactionFailedError, VersionedTransactionPreflightError } from "@/lib/solana/versioned-send";
import { MAX_WALLET_PRIORITY_FEE_LAMPORTS } from "@/lib/solana/deployment-signing";

export function CreatorProof({ handle }: { handle: string }) {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const queryClient = useQueryClient();
  const address = publicKey?.toBase58();
  const configured = isTikTokLaunchReady();
  const escrow = useEscrowAvailability();
  const manual = Boolean(VERIFIER?.equals(ADMIN_WALLET));
  const ready = configured && manual && escrow.available;
  const [videoUrl, setVideoUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [receipts, setReceipts] = useState<
    Array<{ signature: string; status: string }>
  >([]);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const access = useRef({ address, handle, ready, connected, endpoint: connection.rpcEndpoint });
  access.current = { address, handle, ready, connected, endpoint: connection.rpcEndpoint };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    setVideoUrl("");
    setMessage(null);
    setReceipts([]);
  }, [address]);
  function assertContext() {
    const current = access.current;
    if (!mounted.current || !current.ready || !current.connected || current.address !== address || current.handle !== handle || current.endpoint !== connection.rpcEndpoint) {
      throw new Error("The creator, wallet or connection changed. Refresh this page before signing a new request.");
    }
  }
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const proof = useQuery({
    queryKey: ["creator-proof", handle, address, connection.rpcEndpoint],
    enabled: Boolean(ready && address),
    queryFn: async () => {
      if ((await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH) throw new Error("Read creator verification from Solana mainnet.");
      return readCreatorProof(connection, handle, publicKey!);
    },
    refetchInterval: 10_000,
    retry: false,
  });
  const vault = useQuery({
    queryKey: ["creator-vault", handle, connection.rpcEndpoint],
    enabled: ready,
    queryFn: async () => {
      if ((await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH) throw new Error("Read creator verification from Solana mainnet.");
      return creatorVaultClaimable(connection, handle);
    },
    refetchInterval: 10_000,
    retry: false,
  });
  const requestQuote = useQuery({
    queryKey: ["creator-proof-rent", handle, address, vault.data?.exists, connection.rpcEndpoint],
    enabled: Boolean(
      ready &&
        publicKey &&
        vault.data &&
        !vault.data.beneficiary &&
        proof.data === null,
    ),
    staleTime: 15_000,
    retry: false,
    queryFn: async () => {
      if (
        !publicKey ||
        (await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH
      )
        throw new Error("Verification costs must be read from Solana mainnet.");
      await assertTikTokEscrowDeployed(connection);
      const [proofRent, vaultRent, walletBalance, walletRent, latest] = await Promise.all([
        connection.getMinimumBalanceForRentExemption(
          CREATOR_PROOF_SIZE,
          "confirmed",
        ),
        vault.data?.exists
          ? Promise.resolve(0)
          : connection.getMinimumBalanceForRentExemption(
              CREATOR_VAULT_SIZE,
              "confirmed",
            ),
        connection.getBalance(publicKey, "confirmed"),
        connection.getMinimumBalanceForRentExemption(0, "confirmed"),
        connection.getLatestBlockhash("confirmed"),
      ]);
      const instructions = [
        ...(!vault.data?.exists
          ? [initCreatorVaultInstruction(publicKey, handle)]
          : []),
        requestCreatorProofInstruction(
          handle,
          publicKey,
          generateCreatorProofNonce(),
        ),
      ];
      const transaction = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: latest.blockhash,
        instructions,
      }).compileToV0Message();
      const fee = (await connection.getFeeForMessage(transaction, "confirmed"))
        .value;
      if (
        fee === null ||
        ![proofRent, vaultRent, walletBalance, walletRent, fee].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        )
      )
        throw new Error(
          "Mainnet could not provide a reliable verification cost quote.",
        );
      const reserve = BigInt(walletRent) + MAX_WALLET_PRIORITY_FEE_LAMPORTS;
      const required = BigInt(proofRent) + BigInt(vaultRent) + BigInt(fee) + reserve;
      return {
        proofRent: BigInt(proofRent),
        vaultRent: BigInt(vaultRent),
        fee: BigInt(fee),
        reserve,
        balance: BigInt(walletBalance),
        required,
        sufficient: BigInt(walletBalance) >= required,
      };
    },
  });
  const expired = Boolean(
    proof.data &&
      (proof.data.expired || Number(proof.data.expiresAt) * 1000 <= now),
  );
  const ownApproval = Boolean(
    address && vault.data?.approved && vault.data.beneficiary === address,
  );
  const bound = Boolean(vault.data?.verified);
  const video = (() => {
    try {
      return videoUrl.trim()
        ? parseTikTokProofVideo(videoUrl.trim(), handle)
        : null;
    } catch {
      return null;
    }
  })();

  async function refresh() {
    await Promise.all([
      proof.refetch(),
      vault.refetch(),
      queryClient.invalidateQueries({ queryKey: ["snapshot"] }),
    ]);
  }
  const pendingSignatures = receipts.filter((receipt) => receipt.status === "pending").map((receipt) => receipt.signature).join(",");
  const { refetch: refetchProof } = proof;
  const { refetch: refetchVault } = vault;
  useEffect(() => {
    if (!pendingSignatures) return;
    let cancelled = false;
    const signatures = pendingSignatures.split(",");
    const poll = async () => {
      try {
        const statuses = await connection.getSignatureStatuses(signatures, { searchTransactionHistory: true });
        if (cancelled) return;
        for (let index = 0; index < statuses.value.length; index++) {
          const status = statuses.value[index];
          if (!status?.err && status?.confirmationStatus !== "confirmed" && status?.confirmationStatus !== "finalized") continue;
          setReceipts((list) => list.map((receipt) => receipt.signature === signatures[index] ? { ...receipt, status: status.err ? "failed" : "confirmed" } : receipt));
          void refetchProof();
          void refetchVault();
        }
      } catch { /* Keep the receipt pending until the actual chain status is known. */ }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 5_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [connection, pendingSignatures, refetchProof, refetchVault]);
  async function preflight() {
    await escrow.assertAvailable();
    if (!ready)
      throw new Error(
        "The mainnet video verification program is not configured on this deployment.",
      );
    if ((await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH)
      throw new Error(
        "Connect to Solana mainnet to verify your TikTok account.",
      );
  }
  async function send(instructions: TransactionInstruction[], title: string) {
    assertContext();
    if (!publicKey || !signTransaction)
      throw new Error(
        "Connect a Solana wallet that supports transaction signing.",
      );
    const { blockhash } =
      await connection.getLatestBlockhash("confirmed");
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message(),
    );
    const expected = transaction.message.serialize();
    await assertTikTokEscrowDeployed(connection);
    assertContext();
    setBusy(`${title}: approve in your wallet…`);
    const signed = await checkedVersionedSignature(expected, await signTransaction(transaction));
    await assertTikTokEscrowDeployed(connection);
    assertContext();
    try {
      const signature = await sendCheckedVersionedTransaction(connection, signed, (signature) => {
        setReceipts((list) => [...list, { signature, status: "pending" }]);
        setBusy(`${title}: confirming on Solana…`);
      });
      setReceipts((list) => list.map((receipt) => receipt.signature === signature ? { ...receipt, status: "confirmed" } : receipt));
    } catch (error) {
      if (error instanceof VersionedTransactionFailedError) setReceipts((list) => list.map((receipt) => receipt.signature === error.signature ? { ...receipt, status: "failed" } : receipt));
      if (error instanceof VersionedTransactionPreflightError) setReceipts((list) => list.map((receipt) => receipt.signature === error.signature ? { ...receipt, status: "rejected" } : receipt));
      throw error;
    }
  }
  async function run(action: "request" | "attach" | "cancel" | "activate") {
    if (!ready || inFlight.current) return;
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }
    inFlight.current = true;
    setMessage(null);
    try {
      setBusy("Checking the reviewed mainnet program…");
      await preflight();
      assertContext();
      const currentVault = await creatorVaultClaimable(connection, handle);
      assertContext();
      if (action === "request") {
        if (currentVault.beneficiary)
          throw new Error(
            "This creator already has an approved or verified payout wallet.",
          );
        if (await readCreatorProof(connection, handle, publicKey))
          throw new Error(
            "A request already exists for this wallet. Use its code or cancel it first.",
          );
        const quote = await requestQuote.refetch();
        if (quote.error || !quote.data)
          throw (
            quote.error ||
            new Error(
              "The verification rent quote is unavailable. Refresh it before creating a code.",
            )
          );
        if (!quote.data.sufficient)
          throw new Error(
            "Add enough SOL for proof rent, any escrow initialization rent and the network fee.",
          );
        const nonce = generateCreatorProofNonce();
        assertContext();
        await send(
          [
            ...(!currentVault.exists
              ? [initCreatorVaultInstruction(publicKey, handle)]
              : []),
            requestCreatorProofInstruction(handle, publicKey, nonce),
          ],
          "Create verification code",
        );
        setMessage({
          ok: true,
          text: "Your on-chain code is ready. Put the exact code below in a public TikTok video's caption, then submit its URL.",
        });
      } else if (action === "attach") {
        if (!video)
          throw new Error(
            `Use a direct https://www.tiktok.com/@${handle}/video/… URL, not a shortened link.`,
          );
        const current = await readCreatorProof(connection, handle, publicKey);
        if (!current || current.expired)
          throw new Error(
            "This verification request expired or no longer exists. Create a fresh code.",
          );
        await send(
          [
            attachCreatorProofVideoInstruction(
              handle,
              publicKey,
              video.videoId,
            ),
          ],
          "Submit TikTok video",
        );
        setMessage({
          ok: true,
          text: "Video submitted for admin review. Keep the video and its code public until approval.",
        });
      } else if (action === "cancel") {
        await send(
          [cancelCreatorProofInstruction(handle, publicKey)],
          "Cancel verification request",
        );
        setVideoUrl("");
        setMessage({
          ok: true,
          text: "Request cancelled. The proof account's remaining rent was refunded to your wallet.",
        });
      } else {
        if (
          !currentVault.approved ||
          currentVault.verified ||
          currentVault.beneficiary !== publicKey.toBase58()
        )
          throw new Error(
            "Connect the wallet approved for this TikTok creator.",
          );
        await send(
          [
            activateCreatorInstruction(
              handle,
              publicKey,
              currentVault.identityHash,
            ),
          ],
          "Activate approved wallet",
        );
        setMessage({
          ok: true,
          text: "Your approved payout wallet is now active. You can claim this creator's available fees.",
        });
      }
      await refresh();
    } catch (error) {
      if (mounted.current) setMessage({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  }

  return (
    <section className="editorial-panel p-5 sm:p-6">
      <div className="edition-label">01 / Verify ownership</div>
      <h2 className="editorial mt-2 text-[32px] leading-none">
        Verify with a TikTok video.
      </h2>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        Create a wallet-signed code, publish it in a video caption on @{handle},
        and send the original video for admin review. After approval, sign once
        to activate your payout wallet.
      </p>
      {!ready ? (
        <p className="mt-5 border border-line bg-card-2 p-4 text-[13px] leading-relaxed text-ink-3">
          {!escrow.available ? escrow.pausedMessage : "Video verification is paused until the mainnet escrow and admin verification authority are configured."}
        </p>
      ) : !connected ? (
        <button
          className="btn-primary mt-5 px-4 py-3 text-[14px]"
          onClick={() => setVisible(true)}
        >
          Connect your payout wallet →
        </button>
      ) : proof.error || vault.error ? (
        <div className="mt-5">
          <p role="alert" className="text-[13px] text-down-ink">
            {errorMessage(proof.error || vault.error)}
          </p>
          <button
            className="btn-secondary mt-3 px-3 py-2 text-[12px]"
            onClick={() => {
              void refresh();
            }}
          >
            Refresh on-chain verification
          </button>
        </div>
      ) : proof.isLoading || vault.isLoading ? (
        <p className="mt-5 text-[13px] text-ink-3">
          Reading your verification request from Solana…
        </p>
      ) : bound ? (
        <div className="mt-5 border border-line bg-card-2 p-4">
          <div className="edition-label text-neon">Creator wallet verified</div>
          <p className="mt-2 font-mono text-[12px]">
            {shortAddress(vault.data!.beneficiary!)}
          </p>
          <p className="mt-2 text-[12px] text-ink-3">
            {vault.data?.beneficiary === address
              ? "This connected wallet can claim the creator's fees."
              : "Connect this creator's verified wallet to claim."}
          </p>
        </div>
      ) : ownApproval ? (
        <div className="mt-5 border border-neon bg-card-2 p-4">
          <div className="edition-label text-neon">Video approved</div>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            Activate this wallet to complete verification. It becomes the
            permanent beneficiary for @{handle}.
          </p>
          <button
            className="btn-primary mt-4 w-full py-3 text-[14px]"
            disabled={Boolean(busy) || !signTransaction}
            onClick={() => {
              void run("activate");
            }}
          >
            Activate approved wallet →
          </button>
        </div>
      ) : vault.data?.beneficiary ? (
        <p className="mt-5 text-[13px] text-ink-3">
          This creator has an approval for{" "}
          {shortAddress(vault.data.beneficiary)}. Connect the approved wallet to
          activate it.
        </p>
      ) : proof.data ? (
        <div className="mt-5 space-y-4">
          <div className="border border-line bg-card-2 p-4">
            <div className="edition-label">Your exact video-caption code</div>
            <code className="mt-3 block break-all font-mono text-[16px] font-semibold text-neon">
              {proofChallenge(proof.data)}
            </code>
            <button
              type="button"
              className="btn-secondary mt-3 px-3 py-2 text-[12px]"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    proofChallenge(proof.data!),
                  );
                  setMessage({
                    ok: true,
                    text: "Full verification code copied. Put every character in your original video's caption.",
                  });
                } catch {
                  setMessage({
                    ok: false,
                    text: "Clipboard access is unavailable. Select and copy the full code above.",
                  });
                }
              }}
            >
              Copy full verification code
            </button>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
              {expired
                ? "This request expired. Cancel it and create a fresh code."
                : `Publish this exact code in a public video caption on @${handle}. The code expires ${new Date(Number(proof.data.expiresAt) * 1000).toLocaleString()}.`}
            </p>
            <a
              href={tikTokProfileUrl(handle)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-[12px] text-neon hover:underline"
            >
              Open @{handle} on TikTok ↗
            </a>
          </div>
          {proof.data.videoId ? (
            <div className="border border-line p-4">
              <div className="edition-label text-neon">
                {expired ? "Review window expired" : "Waiting for admin review"}
              </div>
              <a
                className="mt-2 inline-block text-[12px] text-neon hover:underline"
                href={`${tikTokProfileUrl(handle)}/video/${proof.data.videoId}`}
                target="_blank"
                rel="noreferrer"
              >
                View submitted TikTok video ↗
              </a>
              <p className="mt-2 text-[12px] text-ink-3">
                Admin approval appears here from Solana. There is no automatic
                approval.
              </p>
            </div>
          ) : null}
          {!expired ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run("attach");
              }}
            >
              <label htmlFor="proof-video-url" className="label">
                Original TikTok video URL
              </label>
              <input
                id="proof-video-url"
                className="input text-[13px]"
                type="url"
                value={videoUrl}
                onChange={(event) => setVideoUrl(event.target.value)}
                placeholder={`https://www.tiktok.com/@${handle}/video/…`}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
              />
              <p className="mt-2 text-[11px] text-ink-3">
                Use the direct video URL for @{handle}. Share tracking is
                removed; shortened links, fragments and other usernames are
                rejected.
              </p>
              <button
                className="btn-primary mt-3 w-full py-3 text-[14px]"
                disabled={Boolean(busy) || !video || !signTransaction}
              >
                {proof.data.videoId
                  ? "Replace submitted video URL →"
                  : "Submit video for admin review →"}
              </button>
            </form>
          ) : null}
          <button
            className="btn-secondary px-3 py-2 text-[12px]"
            disabled={Boolean(busy) || !signTransaction}
            onClick={() => {
              void run("cancel");
            }}
          >
            Cancel request and recover proof rent
          </button>
        </div>
      ) : (
        <div className="mt-5">
          <ol className="space-y-2 text-[13px] leading-relaxed text-ink-2">
            <li>1. Create your unique verification code on Solana.</li>
            <li>2. Post it in a public TikTok video caption on @{handle}.</li>
            <li>
              3. Submit the original video URL and wait for admin approval.
            </li>
            <li>4. Activate the approved wallet, then claim your fees.</li>
          </ol>
          <button
            className="btn-primary mt-5 w-full py-3.5 text-[14px]"
            disabled={
              Boolean(busy) ||
              !signTransaction ||
              !requestQuote.data?.sufficient ||
              requestQuote.isFetching ||
              Boolean(requestQuote.error)
            }
            onClick={() => {
              void run("request");
            }}
          >
            Create my verification code →
          </button>
          {requestQuote.data ? (
            <p className="mt-3 text-[11px] leading-relaxed text-ink-2">
              Proof rent: {formatSol(requestQuote.data.proofRent, 8)} SOL,
              refunded on approval or cancellation.{" "}
              {requestQuote.data.vaultRent > 0n
                ? `Escrow initialization rent: ${formatSol(requestQuote.data.vaultRent, 8)} SOL, retained in the escrow. `
                : ""}
              Network fee: about {formatSol(requestQuote.data.fee, 8)} SOL.
              {" "}Wallet and maximum priority-fee reserve: {formatSol(requestQuote.data.reserve, 8)} SOL; unused reserve stays in your wallet.
              Required balance: {formatSol(requestQuote.data.required, 8)} SOL;
              your wallet: {formatSol(requestQuote.data.balance, 8)} SOL.
            </p>
          ) : requestQuote.isFetching ? (
            <p className="mt-3 text-[11px] text-ink-3">
              Reading refundable proof rent and network fees from mainnet…
            </p>
          ) : null}
          {requestQuote.error ? (
            <p role="alert" className="mt-3 text-[12px] text-down-ink">
              {errorMessage(requestQuote.error)}
            </p>
          ) : requestQuote.data && !requestQuote.data.sufficient ? (
            <p role="alert" className="mt-3 text-[12px] text-down-ink">
              Add enough SOL for the required balance before creating a code.
            </p>
          ) : null}
          <button
            type="button"
            className="mt-3 text-[11px] text-neon underline"
            disabled={Boolean(busy) || requestQuote.isFetching}
            onClick={() => {
              void requestQuote.refetch();
            }}
          >
            Refresh verification costs
          </button>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            You pay Solana network fees and refundable proof-account rent.
            Activating an approval makes this payout wallet permanent.
          </p>
        </div>
      )}
      {ready && connected && proof.data && vault.data?.beneficiary ? (
        <div className="mt-5 border border-line bg-card-2 p-4">
          <p className="text-[12px] leading-relaxed text-ink-2">
            Your separate verification request is still open. You can cancel it and recover its remaining rent even though this creator already has an approved payout wallet.
          </p>
          <button type="button" className="btn-secondary mt-3 px-3 py-2 text-[12px]" disabled={Boolean(busy) || !signTransaction} onClick={() => { void run("cancel"); }}>
            Cancel my open request and recover proof rent
          </button>
        </div>
      ) : null}
      {busy ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 text-[13px] text-neon"
        >
          {busy}
        </p>
      ) : null}
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`mt-4 p-3 text-[13px] ${message.ok ? "bg-up-soft text-up-ink" : "bg-down-soft text-down-ink"}`}
        >
          {message.text}
        </p>
      ) : null}
      {receipts.length ? (
        <div className="mt-4 flex flex-wrap gap-3">
          {receipts.map((receipt, index) => (
            <a
              key={receipt.signature}
              href={`https://solscan.io/tx/${receipt.signature}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] text-neon hover:underline"
            >
              Transaction {index + 1} · {receipt.status} ↗
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}
