"use client";

import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { TokenAvatar } from "@/components/TokenAvatar";
import { ADMIN_WALLET, MAINNET_GENESIS_HASH } from "@/lib/admin-config";
import { coinImage } from "@/lib/coin-ui";
import { errorMessage, formatSol, pct } from "@/lib/format";
import {
  assertTikTokEscrowDeployed,
  distributeTransaction,
} from "@/lib/solana/pump";
import { listCoins } from "@/lib/solana/reads";
import { isTikTokLaunchReady } from "@/lib/tiktok-config";
import type { Coin } from "@/lib/types";
import { decode } from "@/lib/wire";

type FeesResponse = { coins: Coin[]; pendingPlatformLamports: bigint };
type Receipt = { signature: string; state: "pending" | "confirmed" | "failed" };

async function loadFees(): Promise<FeesResponse> {
  const response = await fetch("/api/admin/fees", {
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = decode<FeesResponse & { error?: string }>(await response.text());
  if (!response.ok)
    throw new Error(body.error || "Platform fees could not be loaded.");
  if (
    !Array.isArray(body.coins) ||
    typeof body.pendingPlatformLamports !== "bigint"
  )
    throw new Error("The fee service returned incomplete chain data.");
  return body;
}

export function PlatformFees({
  enabled,
  authorize,
  serverAuthenticated = false,
}: {
  enabled: boolean;
  authorize: () => Promise<void>;
  serverAuthenticated?: boolean;
}) {
  const { connection } = useConnection();
  const { connected, publicKey, signAllTransactions, signTransaction } =
    useWallet();
  const authorized = Boolean(
    enabled && connected && publicKey?.equals(ADMIN_WALLET),
  );
  const configured = isTikTokLaunchReady();
  const active = authorized && configured;
  const currentAccess = useRef(active);
  currentAccess.current = active;
  useEffect(() => {
    currentAccess.current = active;
    return () => {
      currentAccess.current = false;
    };
  }, [active]);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const fees = useQuery({
    queryKey: [
      "admin-platform-fees",
      publicKey?.toBase58(),
      serverAuthenticated,
    ],
    queryFn: async () => {
      if (serverAuthenticated) return loadFees();
      if ((await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH)
        throw new Error("Platform fees require Solana mainnet.");
      const actualCoins = (await listCoins(connection)).map((coin) => ({
        ...coin,
        createdAt: null,
        image: undefined,
      }));
      return {
        coins: actualCoins,
        pendingPlatformLamports: actualCoins.reduce(
          (sum, coin) =>
            sum + (coin.pendingFees * BigInt(coin.platformBps)) / 10_000n,
          0n,
        ),
      };
    },
    enabled: active,
    retry: false,
    refetchInterval: active ? 20_000 : false,
  });
  // A cached response is never presented as an authenticated balance after a wallet switch.
  const data = active && !fees.isError ? fees.data : undefined;
  const coins = data?.coins ?? [];
  const collectable = coins.filter(
    (coin) => coin.pendingFees > 0n && coin.platformBps > 0,
  );

  function assertAccess() {
    if (!currentAccess.current || !publicKey?.equals(ADMIN_WALLET))
      throw new Error(
        "Reconnect the authenticated admin wallet before collecting fees.",
      );
  }

  async function assertMainnet() {
    assertAccess();
    if ((await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH)
      throw new Error("Connect to Solana mainnet to collect platform fees.");
    assertAccess();
  }

  function receiptState(signature: string, state: Receipt["state"]) {
    setReceipts((list) =>
      list.map((receipt) =>
        receipt.signature === signature ? { ...receipt, state } : receipt,
      ),
    );
  }

  async function confirmBatch(signatures: string[]) {
    const pending = new Set(signatures);
    let confirmed = 0;
    let failure: unknown;
    for (let attempt = 0; attempt < 50 && pending.size; attempt++) {
      const waiting = [...pending];
      const statuses = await connection
        .getSignatureStatuses(waiting, { searchTransactionHistory: true })
        .catch(() => null);
      waiting.forEach((signature, index) => {
        const status = statuses?.value[index];
        if (status?.err) {
          receiptState(signature, "failed");
          pending.delete(signature);
          failure ??= new Error(
            "A fee distribution failed on Solana. Check its receipt.",
          );
        } else if (
          status?.confirmationStatus === "confirmed" ||
          status?.confirmationStatus === "finalized"
        ) {
          receiptState(signature, "confirmed");
          pending.delete(signature);
          confirmed++;
        }
      });
      if (pending.size && attempt < 49)
        await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (pending.size)
      failure ??= new Error(
        "Some transactions are still confirming. Check their receipts before retrying.",
      );
    return { confirmed, failure };
  }

  async function collect() {
    if (!active || !publicKey || inFlight.current) return;
    if (!signAllTransactions && !signTransaction) {
      setMessage({
        ok: false,
        text: "This wallet does not support transaction signing.",
      });
      return;
    }
    inFlight.current = true;
    setMessage(null);
    let confirmed = 0;
    try {
      setBusy("Checking Solana mainnet and pending fees…");
      await authorize();
      await assertMainnet();
      await assertTikTokEscrowDeployed(connection);
      const refreshed = await fees.refetch();
      if (refreshed.error || !refreshed.data)
        throw refreshed.error || new Error("Pending fee data is unavailable.");
      assertAccess();
      const targets = refreshed.data.coins.filter(
        (coin) => coin.pendingFees > 0n && coin.platformBps > 0,
      );
      if (!targets.length)
        throw new Error("There are no platform fees ready to distribute.");
      const batchSize = signAllTransactions ? 5 : 1;
      for (let offset = 0; offset < targets.length; offset += batchSize) {
        await assertMainnet();
        const batch = targets.slice(offset, offset + batchSize);
        setBusy(
          `Preparing coins ${offset + 1}–${offset + batch.length} of ${targets.length}…`,
        );
        const transactions = await Promise.all(
          batch.map((coin) =>
            distributeTransaction(
              connection,
              publicKey,
              new PublicKey(coin.token),
            ),
          ),
        );
        // Each group receives a fresh blockhash only after its instructions are ready.
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        transactions.forEach((transaction) => {
          transaction.message.recentBlockhash = blockhash;
        });
        assertAccess();
        setBusy(
          `Approve ${batch.length} fee distribution${batch.length === 1 ? "" : "s"} in your wallet…`,
        );
        const signed = signAllTransactions
          ? await signAllTransactions(transactions)
          : [await signTransaction!(transactions[0])];
        assertAccess();
        if (signed.length !== transactions.length)
          throw new Error(
            "The wallet did not sign the complete transaction group.",
          );
        setBusy(`Broadcasting coins ${offset + 1}–${offset + batch.length}…`);
        const sent = await Promise.allSettled(
          signed.map(async (transaction) => {
            assertAccess();
            const signature = await connection.sendRawTransaction(
              transaction.serialize(),
              { maxRetries: 3 },
            );
            setReceipts((list) => [...list, { signature, state: "pending" }]);
            return signature;
          }),
        );
        const signatures: string[] = [];
        let failure: unknown;
        sent.forEach((result) => {
          if (result.status === "fulfilled") signatures.push(result.value);
          else failure ??= result.reason;
        });
        setBusy(
          `Confirming ${signatures.length} transaction${signatures.length === 1 ? "" : "s"} on Solana…`,
        );
        const result = await confirmBatch(signatures);
        confirmed += result.confirmed;
        failure ??= result.failure;
        if (failure) throw failure;
      }
      setMessage({
        ok: true,
        text: `Distributed fees from ${confirmed} coin${confirmed === 1 ? "" : "s"}. The platform share went to its fixed treasury wallet.`,
      });
    } catch (error) {
      setMessage({
        ok: false,
        text: `${confirmed ? `${confirmed} coin${confirmed === 1 ? "" : "s"} confirmed. ` : ""}${errorMessage(error)}`,
      });
    } finally {
      setBusy(null);
      inFlight.current = false;
      if (currentAccess.current) await fees.refetch();
    }
  }

  return (
    <section
      className="editorial-panel card overflow-hidden"
      aria-labelledby="platform-fees-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-5 border-b border-line p-5 sm:p-6">
        <div>
          <div className="eyebrow">On-chain revenue</div>
          <h2
            id="platform-fees-heading"
            className="mt-2 text-[23px] font-semibold"
          >
            Platform fees
          </h2>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-ink-2">
            The platform receives 20% of creator fees. Collection distributes
            every coin&apos;s fees to its fixed shareholders. New coins pay 20% to
            the platform wallet and 80% to creator escrow.
          </p>
        </div>
        <div className="text-right">
          <div className="eyebrow">Pending platform share</div>
          <div className="mt-2 font-mono text-[28px] text-neon">
            {data ? formatSol(data.pendingPlatformLamports, 5) : "—"}
            <span className="ml-2 text-[12px] text-ink-3">SOL</span>
          </div>
          <p className="mt-1 text-[11px] text-ink-3">
            Read from Solana mainnet
          </p>
        </div>
      </div>

      {!authorized ? (
        <p className="p-5 text-[13px] text-ink-3">
          Authenticate the admin wallet to view platform fees.
        </p>
      ) : !configured ? (
        <p className="p-5 text-[13px] leading-relaxed text-ink-3">
          Platform fee indexing is unavailable until the mainnet escrow and
          treasury are configured.
        </p>
      ) : fees.isLoading ? (
        <p role="status" className="p-5 text-[13px] text-ink-3">
          Reading finalized fee splits and balances from Solana…
        </p>
      ) : fees.error ? (
        <div className="p-5">
          <p role="alert" className="text-[13px] text-down-ink">
            {errorMessage(fees.error)}
          </p>
          <button
            className="btn-secondary mt-3"
            disabled={Boolean(busy)}
            onClick={() => {
              void fees.refetch();
            }}
          >
            Retry fee balances
          </button>
        </div>
      ) : !coins.length ? (
        <p className="p-5 text-[13px] text-ink-3">
          No finalized creator coins are indexed yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left">
            <thead className="bg-card-2 text-[10px] uppercase tracking-[0.1em] text-ink-3">
              <tr>
                <th className="px-5 py-3 font-medium">Coin</th>
                <th className="px-4 py-3 font-medium">Platform split</th>
                <th className="px-5 py-3 text-right font-medium">
                  Pending platform fees
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {coins.map((coin) => (
                <tr key={coin.token}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <TokenAvatar
                        src={coinImage(coin)}
                        seed={coin.token}
                        size={34}
                      />
                      <div className="min-w-0">
                        <Link
                          href={`/token/${coin.token}`}
                          className="block max-w-[260px] truncate text-[13px] font-semibold hover:text-neon"
                        >
                          {coin.name}{" "}
                          <span className="font-mono text-[10px] text-ink-3">
                            ${coin.symbol}
                          </span>
                        </Link>
                        <span className="text-[10px] text-ink-3">
                          {coin.graduated ? "pump.fun pool" : "Bonding curve"}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-ink-2">
                    {pct(coin.platformBps)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-[12px] text-neon">
                    {formatSol(
                      (coin.pendingFees * BigInt(coin.platformBps)) / 10_000n,
                      5,
                    )}{" "}
                    SOL
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-3 border-t border-line p-5 sm:p-6">
        <button
          className="btn-primary w-full sm:w-auto"
          disabled={
            !active ||
            !data ||
            !collectable.length ||
            Boolean(busy) ||
            (!signAllTransactions && !signTransaction)
          }
          onClick={() => {
            void collect();
          }}
        >
          {busy
            ? "Collection in progress…"
            : !active || !data
              ? "Fee collection unavailable"
              : collectable.length
                ? `Collect platform fees · ${collectable.length} coin${collectable.length === 1 ? "" : "s"}`
                : "No platform fees ready"}
        </button>
        <p className="text-[11px] leading-relaxed text-ink-3">
          The admin wallet pays the Solana network fee. All fee recipients
          receive their permanent on-chain shares.
        </p>
        {busy ? (
          <p role="status" aria-live="polite" className="text-[12px] text-neon">
            {busy}
          </p>
        ) : null}
        {message ? (
          <p
            role={message.ok ? "status" : "alert"}
            className={`rounded-lg p-3 text-[12px] ${message.ok ? "bg-up-soft text-up-ink" : "bg-down-soft text-down-ink"}`}
          >
            {message.text}
          </p>
        ) : null}
        {receipts.length ? (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {receipts.map((receipt, index) => (
              <a
                key={receipt.signature}
                href={`https://solscan.io/tx/${receipt.signature}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[10px] text-neon hover:underline"
              >
                Transaction {index + 1} · {receipt.state} ↗
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
