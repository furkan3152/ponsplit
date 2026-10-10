"use client";

import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import bs58 from "bs58";
import { useEffect, useMemo, useRef, useState } from "react";
import { TokenAvatar } from "@/components/TokenAvatar";
import { coinImage } from "@/lib/coin-ui";
import { errorMessage, formatSol, pct, shortAddress } from "@/lib/format";
import { useCoins, useDebounced } from "@/lib/hooks";
import {
  isTikTokLaunchReady,
  isValidTikTokHandle,
  normalizeTikTokHandle,
  tikTokProfileUrl,
} from "@/lib/tiktok-config";
import { distributeTransaction } from "@/lib/solana/pump";
import {
  claimCreatorInstruction,
  creatorVaultClaimable,
} from "@/lib/solana/tiktok-escrow";

type AuthStatus = {
  readiness: { oauth: boolean; verification: boolean };
  session: { handle: string; displayName: string; avatar?: string } | null;
  verificationMessage?: string;
};
type VerificationResponse = {
  transaction?: string;
  blockhash?: string;
  lastValidBlockHeight?: number;
  error?: string;
};
const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(
      body.error || "The request could not be completed. Try again.",
    );
  return body;
}

export function CreatorFees({
  initialHandle = "",
}: {
  initialHandle?: string;
}) {
  const { connection } = useConnection();
  const {
    publicKey,
    connected,
    signMessage,
    signTransaction,
    signAllTransactions,
  } = useWallet();
  const { setVisible } = useWalletModal();
  const address = publicKey?.toBase58();
  const configured = isTikTokLaunchReady();
  const [input, setInput] = useState(initialHandle);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [receipts, setReceipts] = useState<string[]>([]);
  const inFlight = useRef(false);
  const edited = useRef(Boolean(initialHandle));
  const handle = normalizeTikTokHandle(useDebounced(input, 350));
  const valid = isValidTikTokHandle(handle);
  const coins = useCoins();
  const auth = useQuery({
    queryKey: ["tiktok-status", address],
    queryFn: () =>
      requestJson<AuthStatus>(
        `/api/tiktok/status${address ? `?wallet=${encodeURIComponent(address)}` : ""}`,
      ),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const vault = useQuery({
    queryKey: ["creator-vault", handle],
    enabled: valid && configured,
    queryFn: () => creatorVaultClaimable(connection, handle),
    refetchInterval: 15_000,
  });
  useEffect(() => {
    if (auth.data?.session && !edited.current) {
      setInput(auth.data.session.handle);
      edited.current = true;
    }
  }, [auth.data?.session]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("tiktok_error"))
      setMessage({
        ok: false,
        text: "TikTok sign-in could not be completed. Try signing in again.",
      });
  }, []);
  const mine = useMemo(
    () =>
      !valid
        ? []
        : (coins.data ?? [])
            .map((coin) => ({
              coin,
              recipient: coin.recipients.find(
                (recipient) => recipient.handle === handle,
              ),
            }))
            .filter(
              (
                item,
              ): item is {
                coin: (typeof item)["coin"];
                recipient: NonNullable<(typeof item)["recipient"]>;
              } => Boolean(item.recipient),
            ),
    [coins.data, handle, valid],
  );
  const pendingTotal = mine.reduce(
    (sum, { coin, recipient }) =>
      sum + (coin.pendingFees * BigInt(recipient.shareBps)) / 10_000n,
    0n,
  );
  const distributable = mine
    .filter(({ coin }) => coin.pendingFees > 0n || coin.graduated)
    .map(({ coin }) => coin.token);
  const beneficiary = vault.data?.beneficiary;
  const ownsVault = Boolean(address && beneficiary === address);
  const session = auth.data?.session;
  const available = Boolean(auth.data?.readiness.verification && configured);

  async function confirmed(signature: string) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const result = (
        await connection
          .getSignatureStatuses([signature], { searchTransactionHistory: true })
          .catch(() => null)
      )?.value[0];
      if (result?.err)
        throw new Error(
          "The transaction was rejected on Solana. Check its receipt and refresh the balance.",
        );
      if (
        result?.confirmationStatus === "confirmed" ||
        result?.confirmationStatus === "finalized"
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error(
      "Solana is still confirming this transaction. Check its receipt before retrying.",
    );
  }

  function recordReceipt(signature: string) {
    setReceipts((list) => [...list, signature]);
  }

  async function assertMainnet() {
    if ((await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH)
      throw new Error(
        "Connect to Solana mainnet to verify, distribute or claim creator fees.",
      );
  }

  async function verify() {
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }
    if (!session || !available || inFlight.current) return;
    if (!signMessage || !signTransaction) {
      setMessage({
        ok: false,
        text: "Use a wallet that supports message and transaction signing, such as Phantom or Solflare.",
      });
      return;
    }
    inFlight.current = true;
    setMessage(null);
    try {
      setBusy("Preparing the wallet ownership message…");
      await assertMainnet();
      const status = await auth.refetch();
      const verificationMessage = status.data?.verificationMessage;
      if (
        !status.data?.session ||
        !verificationMessage ||
        !status.data.readiness.verification
      )
        throw new Error(
          "Your TikTok session or wallet challenge has expired. Sign in again.",
        );
      setBusy("Sign the ownership message in your wallet…");
      const signature = bs58.encode(
        await signMessage(new TextEncoder().encode(verificationMessage)),
      );
      setBusy("Verifying your TikTok account…");
      const response = await requestJson<VerificationResponse>(
        "/api/tiktok/verify",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet: publicKey.toBase58(), signature }),
        },
      );
      if (
        !response.transaction ||
        !response.blockhash ||
        !Number.isSafeInteger(response.lastValidBlockHeight)
      )
        throw new Error(
          "The verifier did not return a complete Solana transaction.",
        );
      const transaction = VersionedTransaction.deserialize(
        Uint8Array.from(atob(response.transaction), (character) =>
          character.charCodeAt(0),
        ),
      );
      if (
        !transaction.message.staticAccountKeys[0]?.equals(publicKey) ||
        transaction.message.recentBlockhash !== response.blockhash
      )
        throw new Error(
          "The verification transaction does not match your wallet challenge.",
        );
      setBusy("Approve the on-chain verification in your wallet…");
      const signed = await signTransaction(transaction);
      const receipt = await connection.sendRawTransaction(signed.serialize(), {
        maxRetries: 3,
      });
      recordReceipt(receipt);
      setBusy("Confirming your creator wallet…");
      const result = await connection.confirmTransaction(
        {
          signature: receipt,
          blockhash: response.blockhash,
          lastValidBlockHeight: response.lastValidBlockHeight!,
        },
        "confirmed",
      );
      if (result.value.err)
        throw new Error(
          "The verification transaction failed. Check its receipt.",
        );
      setInput(status.data.session.handle);
      edited.current = true;
      setMessage({
        ok: true,
        text: `@${status.data.session.handle} is now linked to your wallet on Solana.`,
      });
      await Promise.all([auth.refetch(), vault.refetch(), coins.refetch()]);
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  }

  async function claim() {
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }
    if (!ownsVault || !valid || inFlight.current) return;
    if (!signTransaction) {
      setMessage({
        ok: false,
        text: "This wallet does not support transaction signing.",
      });
      return;
    }
    inFlight.current = true;
    setMessage(null);
    try {
      setBusy("Checking your creator balance…");
      await assertMainnet();
      const current = await creatorVaultClaimable(connection, handle);
      if (current.beneficiary !== publicKey.toBase58())
        throw new Error("Connect the wallet verified for this TikTok creator.");
      if (current.claimable <= 0n)
        throw new Error(
          "There are no fees ready to claim yet. Distribute pending coin fees first.",
        );
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: blockhash,
          instructions: [claimCreatorInstruction(handle, publicKey)],
        }).compileToV0Message(),
      );
      setBusy("Approve your claim in the wallet…");
      const signed = await signTransaction(transaction);
      const receipt = await connection.sendRawTransaction(signed.serialize(), {
        maxRetries: 3,
      });
      recordReceipt(receipt);
      setBusy("Confirming the SOL payment…");
      const result = await connection.confirmTransaction(
        { signature: receipt, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      if (result.value.err)
        throw new Error("The claim failed on Solana. Check its receipt.");
      setMessage({
        ok: true,
        text: "Claim confirmed. Creator fees were sent to your verified wallet.",
      });
      await Promise.all([vault.refetch(), coins.refetch()]);
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  }

  async function distribute() {
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }
    if (!distributable.length || inFlight.current) return;
    if (!signAllTransactions && !signTransaction) {
      setMessage({
        ok: false,
        text: "This wallet does not support transaction signing.",
      });
      return;
    }
    inFlight.current = true;
    setMessage(null);
    let success = 0;
    try {
      setBusy("Checking Solana mainnet…");
      await assertMainnet();
      const batchSize = signAllTransactions ? 5 : 1;
      // Later batches are prepared after confirmation, so their blockhashes remain fresh.
      for (let offset = 0; offset < distributable.length; offset += batchSize) {
        const batch = distributable.slice(offset, offset + batchSize);
        setBusy(
          `Preparing ${offset + 1}–${offset + batch.length} of ${distributable.length} coins…`,
        );
        const transactions = await Promise.all(
          batch.map((mint) =>
            distributeTransaction(connection, publicKey, new PublicKey(mint)),
          ),
        );
        setBusy("Approve fee distribution in your wallet…");
        const signed = signAllTransactions
          ? await signAllTransactions(transactions)
          : [await signTransaction!(transactions[0])];
        // Broadcast the signed batch together to avoid expiry while another transaction confirms.
        const sent = await Promise.allSettled(
          signed.map(async (transaction) => {
            const receipt = await connection.sendRawTransaction(
              transaction.serialize(),
              { maxRetries: 3 },
            );
            recordReceipt(receipt);
            return receipt;
          }),
        );
        let failure: unknown;
        for (const result of sent) {
          if (result.status === "rejected") {
            failure ??= result.reason;
            continue;
          }
          setBusy(
            `Confirming coin fees · ${success + 1}/${distributable.length}…`,
          );
          try {
            await confirmed(result.value);
            success++;
          } catch (e) {
            failure ??= e;
          }
        }
        if (failure) throw failure;
      }
      setMessage({
        ok: true,
        text: `Distributed fees from ${success} coin${success === 1 ? "" : "s"}. The creator's share is now in escrow.`,
      });
    } catch (e) {
      setMessage({
        ok: false,
        text: `${success ? `${success} coin${success === 1 ? "" : "s"} distributed. ` : ""}${errorMessage(e)}`,
      });
    } finally {
      setBusy(null);
      inFlight.current = false;
      await Promise.all([vault.refetch(), coins.refetch()]);
    }
  }

  async function logout() {
    try {
      await requestJson("/api/tiktok/logout", { method: "POST" });
      await auth.refetch();
      setMessage(null);
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    }
  }

  return (
    <div className="space-y-7 py-4 sm:py-6">
      <header className="max-w-3xl">
        <div className="eyebrow text-neon">Creator dashboard</div>
        <h1 className="display mt-3 text-[42px] leading-[1.05] sm:text-[60px]">
          Your TikTok.
          <br />
          <span className="text-neon">Your creator fees.</span>
        </h1>
        <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-ink-2">
          Find the coins launched for your username. Verify your TikTok account,
          bind a Solana wallet and claim the fees your community generates.
        </p>
      </header>

      <section className="card p-5 sm:p-6">
        <label htmlFor="creator-search" className="label">
          Explore a TikTok creator
        </label>
        <div className="relative">
          <span
            aria-hidden
            className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
          >
            @
          </span>
          <input
            id="creator-search"
            className="input h-14 pl-9 text-[17px]"
            value={input}
            onChange={(event) => {
              edited.current = true;
              setInput(event.target.value);
            }}
            placeholder="creator.username"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            aria-describedby="creator-search-help"
          />
        </div>
        <p id="creator-search-help" className="mt-2 text-[12px] text-ink-3">
          {input.trim() && !valid
            ? "Enter a TikTok username with letters, numbers, underscores or periods (up to 24 characters)."
            : "Balances come from Solana. Entering a username does not verify account ownership."}
        </p>
      </section>
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`rounded-2xl p-4 text-[14px] ${message.ok ? "bg-up-soft text-up-ink" : "bg-down-soft text-down-ink"}`}
        >
          {message.text}
        </p>
      ) : null}
      {busy ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-2xl border border-line bg-card-2 p-4 text-[14px] text-neon"
        >
          {busy}
        </p>
      ) : null}
      {receipts.length ? (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {receipts.map((receipt, index) => (
            <a
              key={receipt}
              href={`https://solscan.io/tx/${receipt}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] text-neon hover:underline"
            >
              Transaction {index + 1} ↗
            </a>
          ))}
        </div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <section className="card p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="eyebrow">01 · Prove it is you</div>
                <h2 className="mt-2 text-[23px] font-semibold">
                  Verify your creator account
                </h2>
              </div>
              {session ? (
                <span className="rounded-full bg-up-soft px-3 py-1 text-[11px] text-up-ink">
                  TikTok connected
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
              TikTok sign-in confirms your username. A signed wallet message and
              on-chain verification then link it to your payout wallet.
            </p>
            {auth.isLoading ? (
              <p className="mt-4 text-[13px] text-ink-3">
                Checking TikTok sign-in…
              </p>
            ) : auth.error ? (
              <div className="mt-4">
                <p role="alert" className="text-[13px] text-down-ink">
                  {errorMessage(auth.error)}
                </p>
                <button
                  className="btn-secondary mt-3 px-4 py-2 text-[13px]"
                  onClick={() => {
                    void auth.refetch();
                  }}
                >
                  Retry sign-in status
                </button>
              </div>
            ) : session ? (
              <div className="mt-5 rounded-2xl border border-line bg-card-2 p-4">
                <div className="font-semibold">@{session.handle}</div>
                <div className="mt-1 text-[12px] text-ink-2">
                  {session.displayName}
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
                  {address
                    ? `Payout wallet: ${shortAddress(address)}`
                    : "Connect the Solana wallet you want to use for payouts."}{" "}
                  Once verified, this creator wallet cannot be changed.
                </p>
                <button
                  className="btn-neon mt-4 w-full py-3 text-[14px]"
                  disabled={
                    Boolean(busy) ||
                    !available ||
                    (connected && (!signMessage || !signTransaction))
                  }
                  onClick={() => {
                    void verify();
                  }}
                >
                  {!available
                    ? "Wallet verification unavailable"
                    : !connected
                      ? "Connect payout wallet"
                      : `Verify @${session.handle} on Solana →`}
                </button>
                {!available ? (
                  <p className="mt-2 text-[12px] text-ink-3">
                    The on-chain verification service has not been configured
                    for this deployment.
                  </p>
                ) : connected && (!signMessage || !signTransaction) ? (
                  <p className="mt-2 text-[12px] text-down-ink">
                    Choose a wallet that supports message and transaction
                    signing.
                  </p>
                ) : null}
                <button
                  className="mt-3 text-[12px] text-ink-3 underline hover:text-ink"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    void logout();
                  }}
                >
                  Sign out of TikTok
                </button>
              </div>
            ) : auth.data?.readiness.oauth ? (
              <a
                className={`btn-neon mt-5 w-full py-3.5 text-[14px] ${busy ? "pointer-events-none opacity-50" : ""}`}
                href="/api/tiktok/login"
              >
                Connect TikTok account →
              </a>
            ) : (
              <div className="mt-4 rounded-xl bg-card-2 p-4 text-[13px] leading-relaxed text-ink-2">
                TikTok sign-in is not configured on this deployment. Fees can be
                viewed below; claiming requires account verification.
              </div>
            )}
          </section>

          {valid ? (
            <section className="card p-5 sm:p-6">
              <div className="eyebrow">02 · Community coins</div>
              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-[23px] font-semibold">
                  Coins for @{handle}
                </h2>
                <a
                  href={tikTokProfileUrl(handle)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] text-neon hover:underline"
                >
                  TikTok profile ↗
                </a>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                Distribute pending creator fees from pump.fun into the permanent
                fee accounts. Anyone can do this by paying the Solana network
                fee.
              </p>
              {!configured ? (
                <p className="py-8 text-[13px] leading-relaxed text-ink-3">
                  Creator coin indexing is unavailable until this
                  deployment&apos;s escrow and treasury are configured.
                </p>
              ) : coins.isLoading ? (
                <p className="py-8 text-[13px] text-ink-3">
                  Reading creator coins from Solana…
                </p>
              ) : coins.error ? (
                <p role="alert" className="mt-4 text-[13px] text-down-ink">
                  {errorMessage(coins.error)}
                </p>
              ) : !mine.length ? (
                <div className="py-8 text-center">
                  <p className="text-[14px] text-ink-2">
                    No indexed coins pay @{handle} yet.
                  </p>
                  <Link
                    href="/create"
                    className="btn-secondary mt-4 inline-flex px-4 py-2.5 text-[13px]"
                  >
                    Launch a creator coin →
                  </Link>
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-line">
                  {mine.map(({ coin, recipient }) => (
                    <li
                      key={coin.token}
                      className="flex items-center gap-3 py-4"
                    >
                      <TokenAvatar
                        src={coinImage(coin)}
                        seed={coin.token}
                        size={42}
                      />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/token/${coin.token}`}
                          className="block truncate text-[14px] font-semibold hover:text-neon"
                        >
                          {coin.name}{" "}
                          <span className="font-mono text-[11px] text-ink-3">
                            ${coin.symbol}
                          </span>
                        </Link>
                        <div className="mt-1 text-[11px] text-ink-3">
                          {pct(recipient.shareBps)} of creator fees
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-mono text-[13px] text-neon">
                          {formatSol(
                            (coin.pendingFees * BigInt(recipient.shareBps)) /
                              10_000n,
                            5,
                          )}{" "}
                          SOL
                        </span>
                        <div className="mt-1 text-[10px] text-ink-3">
                          pending distribution
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {configured && distributable.length ? (
                <button
                  className="btn-secondary mt-4 w-full py-3 text-[14px]"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    void distribute();
                  }}
                >
                  {connected
                    ? `Distribute fees from ${distributable.length} coin${distributable.length === 1 ? "" : "s"}`
                    : "Connect wallet to distribute"}
                </button>
              ) : null}
            </section>
          ) : null}
        </div>

        <aside className="card p-5 sm:p-6 lg:sticky lg:top-24">
          <div className="eyebrow">03 · Your payout</div>
          <h2 className="mt-2 text-[23px] font-semibold">
            {valid ? `@${handle}` : "Creator escrow"}
          </h2>
          <span
            className={`mt-3 inline-flex rounded-full px-3 py-1 text-[11px] ${beneficiary ? "bg-up-soft text-up-ink" : "bg-card-2 text-ink-3"}`}
          >
            {beneficiary
              ? "Wallet verified on Solana"
              : "Awaiting creator verification"}
          </span>
          <dl className="mt-6 space-y-5">
            <div>
              <dt className="eyebrow">In creator escrow</dt>
              <dd className="mt-2 font-mono text-[32px] leading-none text-neon">
                {!valid || !configured
                  ? "—"
                  : vault.data
                    ? formatSol(vault.data.claimable, 5)
                    : vault.isError
                      ? "—"
                      : "…"}{" "}
                <span className="text-[14px] text-ink-2">SOL</span>
              </dd>
            </div>
            <div className="border-t border-line pt-4">
              <dt className="text-[12px] text-ink-3">Pending in coins</dt>
              <dd className="mt-1 font-mono text-[18px]">
                {valid && configured && coins.data && !coins.error
                  ? formatSol(pendingTotal, 5)
                  : "—"}{" "}
                SOL
              </dd>
            </div>
            {vault.data && vault.data.totalClaimed > 0n ? (
              <div>
                <dt className="text-[12px] text-ink-3">Claimed to date</dt>
                <dd className="mt-1 font-mono text-[15px]">
                  {formatSol(vault.data.totalClaimed, 5)} SOL
                </dd>
              </div>
            ) : null}
          </dl>
          {valid && !configured ? (
            <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
              The creator escrow is not configured on this deployment.
            </p>
          ) : vault.error ? (
            <p role="alert" className="mt-4 text-[12px] text-down-ink">
              {errorMessage(vault.error)}
            </p>
          ) : vault.data && !vault.data.exists ? (
            <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
              This escrow is not initialized yet. A creator coin or account
              verification initializes it.
            </p>
          ) : !beneficiary && vault.data ? (
            <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
              Fees remain in this escrow until the TikTok account owner verifies
              a payout wallet.
            </p>
          ) : beneficiary ? (
            <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
              Verified payout wallet:{" "}
              <span className="font-mono text-ink-2">
                {shortAddress(beneficiary)}
              </span>
            </p>
          ) : null}
          <button
            className="btn-neon mt-5 w-full py-3.5 text-[15px]"
            disabled={
              Boolean(busy) ||
              !valid ||
              !configured ||
              !beneficiary ||
              (connected &&
                (!ownsVault || !vault.data?.claimable || !signTransaction))
            }
            onClick={() => {
              void claim();
            }}
          >
            {!beneficiary
              ? "Verify a wallet to claim"
              : !connected
                ? "Connect verified wallet"
                : !ownsVault
                  ? "Connect the verified wallet"
                  : !vault.data?.claimable
                    ? "No fees ready to claim"
                    : "Claim SOL to your wallet →"}
          </button>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            Only the verified beneficiary wallet can withdraw. A small rent
            reserve remains in the escrow account.
          </p>
          {vault.data?.account ? (
            <a
              href={`https://solscan.io/account/${vault.data.account}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-[11px] text-neon hover:underline"
            >
              View escrow on Solana ↗
            </a>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
