"use client";

import { MAINNET_GENESIS_HASH } from "@/lib/admin-config";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { CreatorProof } from "@/components/CreatorProof";
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
import {
  assertTikTokEscrowDeployed,
  distributeTransaction,
} from "@/lib/solana/pump";
import { PLATFORM_BPS } from "@/lib/solana/config";
import {
  claimCreatorInstruction,
  creatorVaultClaimable,
} from "@/lib/solana/tiktok-escrow";
import { checkedVersionedSignature } from "@/lib/solana/versioned-signing";
import { sendCheckedVersionedTransaction } from "@/lib/solana/versioned-send";

export function CreatorFees({
  initialHandle = "",
}: {
  initialHandle?: string;
}) {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction, signAllTransactions } =
    useWallet();
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
  const handle = normalizeTikTokHandle(useDebounced(input, 350));
  const valid = isValidTikTokHandle(handle);
  const mounted = useRef(false);
  const access = useRef({ address, connected, handle: normalizeTikTokHandle(input), endpoint: connection.rpcEndpoint });
  access.current = { address, connected, handle: normalizeTikTokHandle(input), endpoint: connection.rpcEndpoint };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  function assertContext() {
    const current = access.current;
    if (!mounted.current || !current.connected || current.address !== address || current.handle !== handle || current.endpoint !== connection.rpcEndpoint) {
      throw new Error("The creator, wallet or connection changed. Refresh before signing another transaction.");
    }
  }
  const coins = useCoins();
  const vault = useQuery({
    queryKey: ["creator-vault", handle, connection.rpcEndpoint],
    enabled: valid && configured,
    queryFn: async () => {
      if ((await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH) throw new Error("Read creator balances from Solana mainnet.");
      return creatorVaultClaimable(connection, handle);
    },
    refetchInterval: 15_000,
  });
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
  const ownsVault = Boolean(
    address && beneficiary === address && vault.data?.verified,
  );

  function recordReceipt(signature: string) {
    setReceipts((list) => [...list, signature]);
  }

  async function assertMainnet() {
    if ((await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH)
      throw new Error(
        "Connect to Solana mainnet to verify, distribute or claim creator fees.",
      );
    await assertTikTokEscrowDeployed(connection);
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
      assertContext();
      const current = await creatorVaultClaimable(connection, handle);
      assertContext();
      if (!current.verified || current.beneficiary !== publicKey.toBase58())
        throw new Error("Connect the wallet verified for this TikTok creator.");
      if (current.claimable <= 0n)
        throw new Error(
          "There are no fees ready to claim yet. Distribute pending coin fees first.",
        );
      const { blockhash } =
        await connection.getLatestBlockhash("confirmed");
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: blockhash,
          instructions: [claimCreatorInstruction(handle, publicKey)],
        }).compileToV0Message(),
      );
      const expected = transaction.message.serialize();
      assertContext();
      setBusy("Approve your claim in the wallet…");
      const signed = await checkedVersionedSignature(expected, await signTransaction(transaction));
      assertContext();
      setBusy("Confirming the SOL payment…");
      await sendCheckedVersionedTransaction(connection, signed, recordReceipt);
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
      assertContext();
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
        const expected = transactions.map((transaction) => transaction.message.serialize());
        assertContext();
        setBusy("Approve fee distribution in your wallet…");
        const returned = signAllTransactions
          ? await signAllTransactions(transactions)
          : [await signTransaction!(transactions[0])];
        if (returned.length !== transactions.length) throw new Error("The wallet returned an incomplete distribution batch. No transaction was submitted.");
        const signed = await Promise.all(returned.map((transaction, index) => checkedVersionedSignature(expected[index], transaction)));
        assertContext();
        // Broadcast the signed batch together to avoid expiry while another transaction confirms.
        const sent = await Promise.allSettled(
          signed.map((transaction) => sendCheckedVersionedTransaction(connection, transaction, recordReceipt)),
        );
        let failure: unknown;
        for (const result of sent) {
          if (result.status === "rejected") {
            failure ??= result.reason;
            continue;
          }
          success++;
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
          Find the coins launched for your username. Verify with a public TikTok
          video, bind a Solana wallet and claim the fees your community
          generates. New coins reserve {(10_000 - PLATFORM_BPS) / 100}% of
          pump.fun creator fees for the TikTok beneficiary and{" "}
          {PLATFORM_BPS / 100}% for the platform.
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
          {valid ? (
            <CreatorProof key={handle} handle={handle} />
          ) : (
            <section className="editorial-panel p-5 sm:p-6">
              <div className="edition-label">01 / Verify ownership</div>
              <h2 className="editorial mt-2 text-[32px] leading-none">
                Verify with a TikTok video.
              </h2>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                Enter your TikTok username above, then connect your payout
                wallet to create a unique on-chain verification code. Publish
                the exact wallet-bound code in a public video caption, submit
                the original video URL, and activate your wallet after admin
                approval.
              </p>
            </section>
          )}

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
            className={`mt-3 inline-flex rounded-full px-3 py-1 text-[11px] ${vault.data?.verified ? "bg-up-soft text-up-ink" : "bg-card-2 text-ink-3"}`}
          >
            {vault.data?.verified
              ? "Wallet verified on Solana"
              : vault.data?.approved
                ? "Approved · awaiting wallet activation"
                : "Awaiting video verification"}
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
              {vault.data?.verified
                ? "Verified payout wallet:"
                : "Approved payout wallet:"}{" "}
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
              !vault.data?.verified ||
              (connected &&
                (!ownsVault || !vault.data?.claimable || !signTransaction))
            }
            onClick={() => {
              void claim();
            }}
          >
            {!vault.data?.verified
              ? vault.data?.approved
                ? "Activate approved wallet to claim"
                : "Verify with a video to claim"
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
