"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Keypair, PublicKey, type VersionedTransaction } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TokenAvatar } from "@/components/TokenAvatar";
import { useRiskGate } from "@/components/RiskNotice";
import {
  errorMessage,
  formatSol,
  pct,
  shortAddress,
} from "@/lib/format";
import { useSolBalance } from "@/lib/hooks";
import { safeUrl } from "@/lib/metadata";
import { shrinkImage } from "@/lib/shrink-image";
import {
  isTikTokLaunchReady,
  isValidTikTokHandle,
  normalizeTikTokHandle,
  tikTokProfileUrl,
} from "@/lib/tiktok-config";
import { LAUNCH_FEE_LAMPORTS, PLATFORM_BPS } from "@/lib/solana/config";
import {
  createTikTokTransaction,
  finishTikTokLaunchTransactions,
  tikTokLaunchState,
} from "@/lib/solana/pump";
import { checkedVersionedSignature } from "@/lib/solana/versioned-signing";
import { sendCheckedVersionedTransaction } from "@/lib/solana/versioned-send";
import { recoverTikTokLaunch } from "@/lib/solana/launch-recovery";

const PENDING_KEY = "tiksplit:pending-launch:v1";
const RENT_ESTIMATE = 40_000_000n;
type PendingLaunch = {
  mint: string;
  symbol: string;
  handle: string;
  launcherBps: number;
  platformBps?: number;
  metadataUri: string;
  at: number;
  signatures?: string[];
  restored?: boolean;
};
type Recovery = {
  launch: PendingLaunch;
  state: "missing" | "needs-split" | "done" | "error";
  error?: string;
};

function readPending(wallet: string): PendingLaunch[] {
  try {
    const all = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}");
    if (!all || typeof all !== "object" || !Array.isArray(all[wallet]))
      return [];
    return all[wallet].filter((p: PendingLaunch) => {
      try {
        return (
          Boolean(new PublicKey(p.mint)) &&
          typeof p.symbol === "string" &&
          isValidTikTokHandle(p.handle) &&
          Number.isInteger(p.launcherBps) &&
          p.launcherBps >= 0 &&
          p.launcherBps <= 1000 &&
          (p.platformBps === undefined ||
            (Number.isInteger(p.platformBps) &&
              p.platformBps > 0 &&
              p.platformBps < 10_000)) &&
          typeof p.metadataUri === "string" &&
          Boolean(safeUrl(p.metadataUri)) &&
          Number.isFinite(p.at)
        );
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function updatePending(wallet: string, launch: PendingLaunch, remove = false) {
  let all: Record<string, PendingLaunch[]> = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      all = parsed;
  } catch {
    /* Start a clean recovery index if an old value cannot be read. */
  }
  const rest = readPending(wallet).filter((p) => p.mint !== launch.mint);
  all[wallet] = remove ? rest : [...rest, launch];
  if (!all[wallet].length) delete all[wallet];
  localStorage.setItem(PENDING_KEY, JSON.stringify(all));
}

export default function CreatePage() {
  const router = useRouter();
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction, signAllTransactions } = useWallet();
  const { setVisible } = useWalletModal();
  const { guard, dialog } = useRiskGate();
  const balance = useSolBalance();
  const address = publicKey?.toBase58();
  const currentAddress = useRef(address);
  currentAddress.current = address;
  const currentEndpoint = useRef(connection.rpcEndpoint);
  currentEndpoint.current = connection.rpcEndpoint;
  const configured = isTikTokLaunchReady();
  const readiness = useQuery({
    queryKey: ["runtime-launch-readiness"],
    queryFn: async () => {
      const response = await fetch("/api/runtime-status", { cache: "no-store" });
      if (!response.ok) throw new Error("Launch readiness could not be checked.");
      return response.json() as Promise<{ launchesReady: boolean }>;
    },
    refetchInterval: 30_000,
    retry: false,
  });
  const ready = configured && readiness.data?.launchesReady === true;
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [handleInput, setHandleInput] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingLaunch[]>([]);
  const [recoverMint, setRecoverMint] = useState("");
  const [requestedRecovery, setRequestedRecovery] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [recoveredComplete, setRecoveredComplete] = useState<string | null>(null);
  const [reviewedRecovery, setReviewedRecovery] = useState<Record<string, boolean>>({});
  const attemptedRecovery = useRef(new Set<string>());
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const handle = normalizeTikTokHandle(handleInput);
  const launcherBps = 0;
  const creatorBps = 10_000 - PLATFORM_BPS;
  const imageUrl = image ? safeUrl(image) : undefined;
  const refreshPending = () => setPending(address ? readPending(address) : []);
  useEffect(() => {
    setPending(address ? readPending(address) : []);
    setReviewedRecovery({});
    setRecoverError(null);
  }, [address]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("recover");
    if (requested) { setRecoverMint(requested); setRequestedRecovery(requested); }
  }, []);

  const restoreExistingMint = useCallback(async (input: string) => {
    if (!publicKey || !address) { setVisible(true); return; }
    if (!configured || inFlight.current) return;
    inFlight.current = true;
    setRecovering(true);
    setRecoverError(null);
    setRecoveredComplete(null);
    const endpoint = connection.rpcEndpoint;
    try {
      const result = await recoverTikTokLaunch(connection, input, publicKey);
      if (currentAddress.current !== address || currentEndpoint.current !== endpoint) throw new Error("Reconnect the original launching wallet before restoring this mint.");
      if (result.state === "done") {
        setRecoveredComplete(result.launch.mint);
      } else {
        const existing = readPending(address).find((launch) => launch.mint === result.launch.mint);
        // Chain-validated recipients and policy stay authoritative; restoring a
        // saved mint must retain its original creation time and payment receipts.
        updatePending(address, {
          ...result.launch,
          at: existing?.at ?? result.launch.at,
          signatures: existing?.signatures,
        });
        setPending(readPending(address));
      }
    } catch (error) {
      setRecoverError(errorMessage(error));
    } finally {
      setRecovering(false);
      inFlight.current = false;
    }
  }, [address, configured, connection, publicKey, setVisible]);
  useEffect(() => {
    if (!requestedRecovery || !address || !configured) return;
    const key = `${address}:${requestedRecovery}`;
    if (attemptedRecovery.current.has(key)) return;
    attemptedRecovery.current.add(key);
    void restoreExistingMint(requestedRecovery);
  }, [address, configured, requestedRecovery, restoreExistingMint]);

  const recovery = useQuery({
    queryKey: ["tiktok-launch-recovery", address, pending, connection.rpcEndpoint],
    enabled: Boolean(configured && address && pending.length),
    refetchInterval: 15_000,
    queryFn: async (): Promise<Recovery[]> =>
      Promise.all(
        pending.map(async (launch) => {
          try {
            const state = await tikTokLaunchState(
              connection,
              new PublicKey(launch.mint),
              {
                handle: launch.handle,
                launcher: new PublicKey(address!),
                launcherBps: launch.launcherBps,
                platformBps: launch.platformBps ?? 1000,
                metadataUri: launch.metadataUri,
              },
            );
            return { launch, state };
          } catch (e) {
            return { launch, state: "error", error: errorMessage(e) };
          }
        }),
      ),
  });
  useEffect(() => {
    if (!address || !recovery.data?.some((p) => p.state === "done")) return;
    try {
      recovery.data
        .filter((p) => p.state === "done")
        .forEach((p) => updatePending(address, p.launch, true));
      setPending(readPending(address));
    } catch {
      /* A confirmed launch remains visible if browser storage cannot be updated. */
    }
  }, [address, recovery.data]);

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!name.trim() || name.trim().length > 32)
      list.push("Add a coin name, up to 32 characters.");
    if (!/^[A-Za-z0-9]{1,10}$/.test(symbol.trim()))
      list.push("Add a ticker with 1–10 letters or numbers.");
    if (!imageUrl) list.push("Upload a coin image.");
    if (description.length > 500)
      list.push("Keep the description under 500 characters.");
    if (!isValidTikTokHandle(handle))
      list.push("Enter a valid TikTok username.");
    if (creatorBps <= 0)
      list.push("The creator must receive a positive share.");
    return list;
  }, [name, symbol, imageUrl, description, handle, creatorBps]);
  const total = LAUNCH_FEE_LAMPORTS;
  const insufficient =
    connected &&
    balance.data !== undefined &&
    balance.data < total + RENT_ESTIMATE;
  const touched = Boolean(name || symbol || handleInput || image);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", await shrinkImage(file));
      const response = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });
      const body = (await response.json()) as { uri?: string; error?: string };
      if (!response.ok || !body.uri || !safeUrl(body.uri))
        throw new Error(body.error || "The image could not be uploaded.");
      setImage(body.uri);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function signAndSend(
    transactions: VersionedTransaction[],
    launch: PendingLaunch,
    mintSigner?: Keypair,
  ) {
    if (!address || (!signAllTransactions && !signTransaction))
      throw new Error(
        "Use a wallet that supports signing Solana transactions.",
      );
    // Prepare a fresh hash before approval and capture every message before the adapter
    // can mutate any transaction in place. Keep the temporary mint signer only in memory.
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    transactions.forEach((transaction) => { transaction.message.recentBlockhash = blockhash; });
    if (mintSigner && transactions.length) transactions[0].sign([mintSigner]);
    const messages = transactions.map(transaction => Uint8Array.from(transaction.message.serialize()));
    setStatus("Confirm the transactions in your wallet…");
    const signed = signAllTransactions
      ? await signAllTransactions(transactions)
      : await (async () => {
          const results: VersionedTransaction[] = [];
          for (const transaction of transactions) results.push(await signTransaction!(transaction));
          return results;
        })();
    if (signed.length !== messages.length) throw new Error("The wallet did not sign the complete launch group. No launch transaction was submitted.");
    // A malicious final fee-split transaction must block the entire group, including mint creation.
    const verified = await Promise.all(signed.map((transaction, index) => checkedVersionedSignature(messages[index], transaction, index === 0 && mintSigner ? [mintSigner] : [])));
    if (currentAddress.current !== address) throw new Error("Reconnect the launching wallet before continuing this saved launch.");
    try {
      updatePending(address, launch);
    } catch {
      throw new Error("This browser cannot save launch recovery. Enable local storage before launching.");
    }
    for (let index = 0; index < verified.length; index++) {
      if (currentAddress.current !== address) throw new Error("The connected wallet changed. Resume this saved launch with its original wallet.");
      setStatus(
        index === 0
          ? "Sending the launch transaction…"
          : "Locking the creator fee split…",
      );
      await sendCheckedVersionedTransaction(connection, verified[index], (signature) => {
        // Record the signed ID before sending: a lost RPC response must not hide a paid mint.
        setLastSignature(signature);
        launch.signatures = [...(launch.signatures ?? []), signature];
        updatePending(address, launch);
      });
    }
  }

  async function launchCoin() {
    if (!publicKey || !connected || !address) {
      setVisible(true);
      return;
    }
    if (
      !ready ||
      problems.length ||
      uploading ||
      inFlight.current
    )
      return;
    inFlight.current = true;
    setError(null);
    setLastSignature(null);
    try {
      setStatus("Saving the coin details…");
      const response = await fetch("/api/metadata", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          symbol: symbol.trim().toUpperCase(),
          description: description.trim(),
          image,
          tiktokHandle: handle,
          launcherBps,
          platformBps: PLATFORM_BPS,
        }),
      });
      const metadata = (await response.json()) as {
        uri?: string;
        error?: string;
      };
      if (!response.ok || !metadata.uri || !safeUrl(metadata.uri))
        throw new Error(
          metadata.error || "The coin details could not be saved.",
        );
      const mint = Keypair.generate();
      setStatus("Checking the escrow and preparing the split…");
      // Build every fee transaction before a mint can be sent. Invalid escrow configuration fails here.
      const finish = await finishTikTokLaunchTransactions(
        connection,
        publicKey,
        mint.publicKey,
        handle,
        launcherBps,
        PLATFORM_BPS,
      );
      const create = await createTikTokTransaction(connection, {
        user: publicKey,
        mint: mint.publicKey,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        uri: metadata.uri,
      });
      create.sign([mint]);
      const record: PendingLaunch = {
        mint: mint.publicKey.toBase58(),
        symbol: symbol.trim().toUpperCase(),
        handle,
        launcherBps,
        platformBps: PLATFORM_BPS,
        metadataUri: metadata.uri,
        at: Date.now(),
      };
      await signAndSend([create, ...finish], record, mint);
      const state = await tikTokLaunchState(connection, mint.publicKey, {
        handle,
        launcher: publicKey,
        launcherBps,
        platformBps: PLATFORM_BPS,
        metadataUri: metadata.uri,
      });
      if (state !== "done")
        throw new Error(
          "The mint landed, but the final split is not confirmed. Finish this launch below.",
        );
      updatePending(address, record, true);
      router.push(`/token/${record.mint}?launched=1`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStatus(null);
      inFlight.current = false;
      refreshPending();
    }
  }

  async function finishLaunch(launch: PendingLaunch) {
    if (!publicKey || !address || !configured || inFlight.current) return;
    if (launch.restored && !reviewedRecovery[launch.mint]) {
      setError("Review the restored TikTok username and permanent fee split before finishing this mint.");
      return;
    }
    inFlight.current = true;
    setError(null);
    try {
      setStatus("Checking the saved launch on Solana…");
      const mint = new PublicKey(launch.mint);
      const expected = {
        handle: launch.handle,
        launcher: publicKey,
        launcherBps: launch.launcherBps,
        platformBps: launch.platformBps ?? 1000,
        metadataUri: launch.metadataUri,
      };
      const state = await tikTokLaunchState(connection, mint, expected);
      if (state === "missing")
        throw new Error(
          "This mint has not been confirmed on the connected RPC. Check the transaction receipt before starting another launch.",
        );
      if (state !== "done") {
        const transactions = await finishTikTokLaunchTransactions(
          connection,
          publicKey,
          mint,
          launch.handle,
          launch.launcherBps,
          launch.platformBps ?? 1000,
        );
        await signAndSend(transactions, launch);
      }
      if ((await tikTokLaunchState(connection, mint, expected)) !== "done")
        throw new Error(
          "The fee split is still waiting for confirmation. Keep this recovery record and retry later.",
        );
      updatePending(address, launch, true);
      router.push(`/token/${launch.mint}?launched=1`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStatus(null);
      inFlight.current = false;
      refreshPending();
    }
  }

  return (
    <div className="space-y-8 py-4 sm:py-6">
      <header className="max-w-3xl">
        <div className="eyebrow text-neon">Create · Solana mainnet</div>
        <h1 className="display mt-3 text-[42px] leading-[1.05] sm:text-[60px]">
          Give a creator
          <br />
          <span className="text-neon">their own coin.</span>
        </h1>
        <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-ink-2">
          Launch on pump.fun for a TikTok username. Their creator fees collect
          in escrow until they verify ownership and connect a wallet.
        </p>
      </header>

      <section className="card p-5 sm:p-7" aria-labelledby="restore-launch-heading">
        <div className="eyebrow">Existing mint recovery</div>
        <h2 id="restore-launch-heading" className="mt-2 text-[23px] font-semibold">Already created a coin?</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          Restore its public mint address with the original launching wallet. This checks the existing coin; it does not create another mint or ask for a signature.
        </p>
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void restoreExistingMint(recoverMint); }}>
          <div className="min-w-0 flex-1">
            <label htmlFor="recover-mint" className="label">Existing coin mint address</label>
            <input id="recover-mint" className="input font-mono text-[12px]" value={recoverMint} onChange={(event) => setRecoverMint(event.target.value)} placeholder="Paste the Solana mint address" maxLength={44} spellCheck={false} autoCapitalize="none" autoCorrect="off" />
          </div>
          <button className="btn-secondary px-4 py-3 text-[13px]" disabled={Boolean(status) || recovering || !configured || !recoverMint.trim()}>{recovering ? "Checking the existing mint…" : connected ? "Check and restore mint" : "Connect original wallet"}</button>
        </form>
        {requestedRecovery && !connected ? <p className="mt-3 text-[12px] text-neon">Connect the original launching wallet to restore this coin.</p> : null}
        {recoverError ? <p role="alert" className="mt-3 text-[13px] text-down-ink">{recoverError}</p> : null}
        {recoveredComplete ? <p role="status" className="mt-3 text-[13px] text-up-ink">This coin already has its permanent fee split. <Link className="underline" href={`/token/${recoveredComplete}`}>Open existing coin →</Link></p> : null}
      </section>

      {pending.length ? (
        <section className="card border-neon p-5 sm:p-7" aria-labelledby="saved-launches-heading">
          <div className="eyebrow">Saved launches</div>
          <h2 id="saved-launches-heading" className="mt-2 text-[23px] font-semibold">
            Finish your saved launch
          </h2>
          <p className="mt-2 text-[13px] text-ink-2">
            Recovery checks the mint and immutable fee split on Solana before
            sending another transaction. Trades before the permanent split can leave creator fees to sweep; finishing uses the original wallet and existing mint.
          </p>
          <ul className="mt-4 divide-y divide-line">
            {pending.map((launch) => {
              const checked = recovery.data?.find(
                (item) => item.launch.mint === launch.mint,
              );
              return (
                <li className="py-4" key={launch.mint}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">
                        ${launch.symbol} · @{launch.handle}
                      </div>
                      <div className="mt-1 text-[12px] text-ink-3">
                        Creator{" "}
                        {pct(
                          10_000 -
                            (launch.platformBps ?? 1000) -
                            launch.launcherBps,
                        )}{" "}
                        · launcher {pct(launch.launcherBps)} · platform{" "}
                        {pct(launch.platformBps ?? 1000)}
                      </div>
                      <a
                        href={`https://solscan.io/token/${launch.mint}`}
                        className="mt-2 block font-mono text-[11px] text-neon hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddress(launch.mint)} ↗
                      </a>
                    </div>
                    {checked?.state === "needs-split" ? (
                      <button
                        className="btn-secondary px-4 py-2.5 text-[13px]"
                        disabled={Boolean(status) || recovering || !configured || (launch.restored && !reviewedRecovery[launch.mint])}
                        onClick={() =>
                          guard(() => {
                            void finishLaunch(launch);
                          })
                        }
                      >
                        Finish fee split →
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[12px] text-ink-2">
                    {checked?.state === "error"
                      ? checked.error
                      : checked?.state === "missing"
                        ? "The mint is not confirmed on this RPC yet. Check the saved receipt and let the status refresh."
                        : checked?.state === "needs-split"
                          ? "This mint already exists. Finish its permanent creator fee split; do not create this coin again."
                          : checked?.state === "done"
                            ? "Confirmed with its final fee split."
                            : configured
                              ? "Checking the launch…"
                              : "Configure the escrow to check this launch."}
                  </p>
                  {launch.restored ? <label className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-ink-2"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-neon" checked={Boolean(reviewedRecovery[launch.mint])} onChange={(event) => setReviewedRecovery((current) => ({ ...current, [launch.mint]: event.target.checked }))} /><span>I reviewed the restored recipient @{launch.handle} and permanent {pct(launch.platformBps ?? 1000)} platform / {pct(10_000 - (launch.platformBps ?? 1000) - launch.launcherBps)} creator split before approving. Public metadata alone does not verify TikTok ownership.</span></label> : null}
                  {launch.signatures?.map((signature, index) => (
                    <a
                      className="mr-3 mt-2 inline-block text-[11px] text-neon hover:underline"
                      key={signature}
                      href={`https://solscan.io/tx/${signature}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Transaction {index + 1} ↗
                    </a>
                  ))}
                </li>
              );
            })}
          </ul>
          {error ? <p role="alert" className="mt-3 text-[13px] text-down-ink">{error}</p> : null}
        </section>
      ) : null}
      {!ready ? (
        <div
          role="status"
          className="rounded-2xl border border-line-2 bg-card p-5 text-[14px] leading-relaxed text-ink-2"
        >
          Mainnet launches are paused until creator verification and the mainnet setup are ready. You can prepare
          the coin details below.
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            guard(launchCoin);
          }}
        >
          <section className="card p-5 sm:p-7">
            <div className="eyebrow">01 · The creator</div>
            <h2 className="mt-2 text-[23px] font-semibold">
              Who is this coin for?
            </h2>
            <label htmlFor="tiktok-handle" className="label mt-5">
              TikTok username
            </label>
            <div className="relative">
              <span
                aria-hidden
                className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
              >
                @
              </span>
              <input
                id="tiktok-handle"
                className="input h-13 pl-9"
                value={handleInput}
                onChange={(event) => setHandleInput(event.target.value)}
                placeholder="creator.username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={100}
                aria-describedby="handle-help"
              />
            </div>
            <p
              id="handle-help"
              className="mt-3 text-[13px] leading-relaxed text-ink-2"
            >
              Any valid username can receive a coin. This does not verify the
              account or imply the creator endorses it.
            </p>
            {isValidTikTokHandle(handle) ? (
              <a
                className="mt-2 inline-block text-[13px] text-neon hover:underline"
                href={tikTokProfileUrl(handle)}
                target="_blank"
                rel="noreferrer"
              >
                Check @{handle} on TikTok ↗
              </a>
            ) : null}
          </section>

          <section className="card p-5 sm:p-7">
            <div className="eyebrow">02 · The coin</div>
            <h2 className="mt-2 text-[23px] font-semibold">
              Make it recognizable
            </h2>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <TokenAvatar
                src={imageUrl}
                seed={handle || "new-tiktok-coin"}
                size={80}
              />
              <div>
                <input
                  ref={fileInput}
                  id="coin-image"
                  aria-label="Coin image"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  disabled={uploading || Boolean(status)}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary px-4 py-2.5 text-[14px]"
                  disabled={uploading || Boolean(status)}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploading
                    ? "Uploading…"
                    : image
                      ? "Change image"
                      : "Upload image"}
                </button>
                <p className="mt-2 text-[12px] text-ink-3">
                  PNG, JPG, WebP or GIF
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_150px]">
              <div>
                <label className="label" htmlFor="coin-name">
                  Coin name
                </label>
                <input
                  id="coin-name"
                  className="input"
                  value={name}
                  maxLength={32}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="A name worth sharing"
                />
              </div>
              <div>
                <label className="label" htmlFor="coin-symbol">
                  Ticker
                </label>
                <input
                  id="coin-symbol"
                  className="input font-mono uppercase"
                  value={symbol}
                  maxLength={10}
                  onChange={(event) =>
                    setSymbol(event.target.value.toUpperCase())
                  }
                  placeholder="COIN"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </div>
            </div>
            <label className="label mt-5" htmlFor="coin-description">
              Description{" "}
              <span className="font-normal text-ink-3">· optional</span>
            </label>
            <textarea
              id="coin-description"
              className="input min-h-[120px] resize-y"
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Tell the community what this coin represents."
            />
            <div className="mt-1 text-right font-mono text-[11px] text-ink-3">
              {description.length}/500
            </div>
          </section>

          <section className="card p-5 sm:p-7">
            <div className="eyebrow">03 · Launch, then trade</div>
            <h2 className="mt-2 text-[23px] font-semibold">
              Lock the split before buying
            </h2>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
              Launching creates your coin and locks its 20% / 80% creator fee
              split. Once confirmed, the coin page opens so you can review a live
              quote and buy with a separate wallet approval. No tokens are bought
              during launch, and a first-trade price is not guaranteed.
            </p>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
              Launch uses several transactions. Until the final split is
              confirmed, the coin is unfinished and is not listed here. If
              interrupted, use the saved launch above to finish it.
            </p>
          </section>

          <section className="card p-5 sm:p-7">
            <dl className="space-y-2 text-[13px]">
              {LAUNCH_FEE_LAMPORTS > 0n ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-2">Platform launch fee</dt>
                  <dd>{formatSol(LAUNCH_FEE_LAMPORTS)} SOL</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4 border-t border-line pt-3">
                <dt className="font-semibold">Estimated total</dt>
                <dd className="text-right font-semibold">
                  {formatSol(total)} SOL{" "}
                  <span className="block text-[11px] font-normal text-ink-3">
                    + about {formatSol(RENT_ESTIMATE, 2)} SOL for fees and rent
                  </span>
                </dd>
              </div>
            </dl>
            {touched && problems.length ? (
              <ul className="mt-4 list-disc space-y-1 pl-5 text-[13px] text-ink-2">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
            {insufficient ? (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-down-soft p-3 text-[13px] text-down-ink"
              >
                Your wallet needs more SOL for this launch, including network
                fees and rent.
              </p>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-down-soft p-3 text-[13px] text-down-ink"
              >
                {error}
              </p>
            ) : null}
            {lastSignature ? (
              <a
                className="mt-3 inline-block text-[12px] text-neon hover:underline"
                href={`https://solscan.io/tx/${lastSignature}`}
                target="_blank"
                rel="noreferrer"
              >
                View latest transaction ↗
              </a>
            ) : null}
            <button
              type="submit"
              className="btn-neon mt-5 w-full py-4 text-[16px]"
              disabled={
                !ready ||
                Boolean(status) ||
                uploading ||
                (connected && (problems.length > 0 || insufficient))
              }
            >
              {status ??
                (!ready
                  ? "Mainnet launches are paused"
                  : !connected
                    ? "Connect wallet to launch"
                    : "Launch on pump.fun →")}
            </button>
            <p
              aria-live="polite"
              className="mt-3 text-center text-[11px] leading-relaxed text-ink-3"
            >
              The final creator fee split is locked on chain. Review the
              percentages before signing.
            </p>
          </section>
        </form>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <div className="card overflow-hidden p-5">
            <div className="eyebrow">Your coin preview</div>
            <div className="mt-5 flex items-center gap-3">
              <TokenAvatar
                src={imageUrl}
                seed={handle || "new-tiktok-coin"}
                size={64}
              />
              <div className="min-w-0">
                <div className="truncate text-[20px] font-semibold">
                  {name.trim() || "Your next big thing"}
                </div>
                <div className="mt-1 font-mono text-[13px] text-neon">
                  ${symbol.trim() || "COIN"}
                </div>
              </div>
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
              {description.trim() ||
                "A coin for a creator and the community around them."}
            </p>
            <div className="mt-4 border-t border-line pt-4 text-[13px] text-ink-2">
              For{" "}
              <span className="font-semibold text-ink">
                @{handle || "creator"}
              </span>
              <span className="ml-2 rounded-full bg-card-2 px-2 py-1 text-[10px] uppercase tracking-wider text-ink-3">
                Unverified
              </span>
            </div>
          </div>
          <div className="card p-5">
            <div className="eyebrow">Permanent creator fee split</div>
            <div
              aria-hidden
              className="mt-4 flex h-3 overflow-hidden rounded-full bg-card-3"
            >
              <span
                className="bg-neon"
                style={{ width: `${Math.max(0, creatorBps) / 100}%` }}
              />
              <span
                className="bg-ink-3"
                style={{ width: `${PLATFORM_BPS / 100}%` }}
              />
            </div>
            <dl className="mt-4 space-y-3 text-[13px]">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-2">@{handle || "creator"} · escrow</dt>
                <dd className="font-semibold text-neon">{pct(creatorBps)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-2">Platform</dt>
                <dd className="font-semibold">{pct(PLATFORM_BPS)}</dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-line pt-4 text-[12px] leading-relaxed text-ink-3">
              These percentages apply to pump.fun creator fees. They are not
              token allocations. A creator can claim after TikTok verification
              binds the escrow to their wallet.
            </p>
          </div>
          <Link
            href="/claim"
            className="block px-2 text-[13px] text-ink-2 hover:text-neon"
          >
            Already a creator? Verify and claim →
          </Link>
        </aside>
      </div>

      {dialog}
    </div>
  );
}
