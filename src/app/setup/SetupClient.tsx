"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useAccount, useBalance, useReadContracts, useSendTransaction, useSwitchChain, useWriteContract } from "wagmi";
import { GraduatedArt } from "@/components/art";
import { feeVaultAbi, launcherAbi } from "@/lib/abi";
import { errorMessage, shortAddress } from "@/lib/format";
import { clientFor, useCoins } from "@/lib/hooks";
import { useNetwork } from "@/lib/network-context";
import { explorerLink, isLive, type Network } from "@/lib/networks";
import copyTerms from "@/lib/pons-copy-terms.json";
import { useServerConfig, type ServerConfig } from "@/lib/useServerConfig";

const STORAGE_KEY = "ponsplit:pending-admin-key";

function load(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function save(v: string | null) {
  try {
    if (v) localStorage.setItem(STORAGE_KEY, v);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable: the key just isn't remembered
  }
}

const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/**
 * Setting SplitEarn up on the network picked at the top of the page, from a phone:
 *  1. the server's signing key (made here in the browser, pasted into the host by the owner);
 *  2. every contract deployed from the owner's own wallet (testnet: SplitEarn's copy of pons, then
 *     SplitEarn; mainnet: SplitEarn on the real pons), resumable at any point;
 *  3. the addresses pinned in the site, after which the owner's switches appear here.
 */
export default function SetupClient({ admin }: { admin: Address }) {
  const n = useNetwork();
  const server = useServerConfig();
  const [stored, setStored] = useState<string | null>(null);
  useEffect(() => setStored(load()), []);

  // Once the server runs on the key generated here, the browser copy is no longer needed.
  useEffect(() => {
    if (!server?.signer || !stored) return;
    try {
      if (same(privateKeyToAccount(stored as Hex).address, server.signer)) {
        save(null);
        setStored(null);
      }
    } catch {
      // not a key; leave it for the Forget button
    }
  }, [server?.signer, stored]);

  const live = isLive(n);
  const signer = server?.signer ?? undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-4">
      <div>
        <div className="eyebrow">{n.chain.name}</div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="display mt-2 text-[40px] leading-none">Set up SplitEarn</h1>
          <SignOut admin={admin} />
        </div>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
          {n.isTestnet
            ? "On testnet, your wallet deploys SplitEarn's own copy of pons (pons itself isn't on testnet) and then SplitEarn. Pick the network at the top of the page."
            : "On mainnet, your wallet deploys SplitEarn on top of the real pons. Pick the network at the top of the page."}
        </p>
      </div>

      {/* A key made here earlier that the server doesn't use (step 1 shows it while it's still needed). */}
      {stored && server?.signer ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-[14px]">
          <span className="text-ink-2">A signing key generated on this device is still saved in this browser.</span>
          <button
            className="btn-secondary px-3 py-2 text-[13px]"
            onClick={() => {
              save(null);
              setStored(null);
            }}
          >
            Forget it
          </button>
        </div>
      ) : null}

      <StepCard n={1} title="The site's signing key" state={signer ? "done" : "active"}>
        {!server ? (
          <p className="text-[14px] text-ink-2">Checking the server…</p>
        ) : signer ? (
          <p className="text-[14px] leading-relaxed text-ink-2">
            The server signs launches and claims as <span className="num break-all text-ink">{signer}</span>. It holds no funds and owns nothing; one key serves
            both networks.
          </p>
        ) : (
          <KeyGenerator problem={server.keyProblem ?? undefined} onChange={setStored} />
        )}
      </StepCard>

      <StepCard n={2} title="Deploy from your wallet" state={live ? "done" : signer ? "active" : "todo"}>
        {live ? (
          <ContractList n={n} />
        ) : signer ? (
          <WalletDeploy n={n} signer={signer} />
        ) : (
          <p className="text-[14px] text-ink-2">Finish step 1 first.</p>
        )}
      </StepCard>

      {live ? <Live n={n} server={server} /> : null}
    </div>
  );
}

/** The admin session: who is signed in, and a way out. */
function SignOut({ admin }: { admin: Address }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2 text-[12px] text-ink-2">
      <span className="chip num">admin {shortAddress(admin)}</span>
      <button
        className="underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await fetch("/api/admin/session", { method: "DELETE" }).catch(() => null);
          window.location.reload();
        }}
      >
        Sign out
      </button>
    </div>
  );
}

function ContractList({ n }: { n: Network }) {
  const row = (label: string, value?: Address) =>
    value ? (
      <li className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-ink-2">{label}</span>
        <a className="num break-all text-[12.5px] underline" href={explorerLink(n, "address", value)} target="_blank" rel="noreferrer">
          {value}
        </a>
      </li>
    ) : null;
  return (
    <ul className="space-y-1.5 text-[14px]">
      {row("Launcher", n.launcher)}
      {row("FeeVault", n.feeVault)}
      {row(n.ponsIsCopy ? "pons factory (SplitEarn's copy)" : "pons factory", n.ponsFactory)}
    </ul>
  );
}

type Plan = Awaited<ReturnType<typeof import("@/lib/deploy-plan").readPlan>>;

/**
 * Runs the deployment from the connected wallet, one transaction per step, re-reading the chain
 * before each so nothing is ever sent twice. A reload or another device resumes where it stopped.
 */
function WalletDeploy({ n, signer }: { n: Network; signer: Address }) {
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const client = clientFor(n);
  const balance = useBalance({ address, chainId: n.chain.id, query: { enabled: Boolean(address), refetchInterval: 15_000 } });
  const [running, setRunning] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [txs, setTxs] = useState<Hex[]>([]);
  // Set synchronously on the first tap, so a second tap during the first await can't start a
  // second run.
  const busy = useRef(false);
  // Steps this page saw confirmed; a later read that misses one comes from a node that is behind.
  const confirmed = useRef(new Set<string>());

  const plan = useQuery({
    queryKey: ["deploy-plan", n.id, address, signer],
    enabled: Boolean(address),
    refetchInterval: running ? false : 15_000,
    queryFn: async () => (await import("@/lib/deploy-plan")).readPlan(client, n, address!, signer),
  });
  // On testnet the owner's wallet receives every pons launch fee (it is the copy's protocol fee
  // recipient); a wallet that refuses plain ETH transfers would make launches revert.
  const launchFee = BigInt(copyTerms.launchFeeWei);
  const takesEth = useQuery({
    queryKey: ["accepts-eth", n.id, address],
    // Simulated from the wallet's own balance, so only once it can cover a launch fee.
    enabled: Boolean(address && n.ponsIsCopy && balance.data && balance.data.value > launchFee),
    staleTime: 60_000,
    queryFn: async () => (await import("@/lib/deploy-plan")).acceptsEth(client, address!, launchFee),
  });

  if (!isConnected || !address) {
    return (
      <div className="space-y-3">
        <p className="text-[14px] leading-relaxed text-ink-2">
          Connect the wallet that should own SplitEarn{n.ponsIsCopy ? " and its pons copy" : ""}. It deploys every contract and pays the gas; its key never
          leaves the wallet. On a phone, open this page in your wallet app&apos;s browser.
        </p>
        <button className="btn-primary" onClick={openConnectModal}>
          Connect wallet
        </button>
      </div>
    );
  }

  const p = plan.data;
  const left = p ? p.steps.filter((s) => !s.done).length : undefined;
  const empty = balance.data?.value === 0n;

  async function run() {
    if (busy.current || !address) return;
    busy.current = true;
    setErr(null);
    setRunning("Checking…");
    const { readPlan } = await import("@/lib/deploy-plan");
    try {
      if (chainId !== n.chain.id) {
        setRunning("Switching network…");
        await switchChainAsync({ chainId: n.chain.id });
      }
      for (let round = 0; round < 40; round++) {
        let current: Plan = await readPlan(client, n, address, signer);
        // A step confirmed a moment ago but not visible yet: the node is behind, so wait for it
        // rather than send it again.
        for (let wait = 0; wait < 10 && current.steps.some((s) => !s.done && confirmed.current.has(s.key)); wait++) {
          await new Promise((r) => setTimeout(r, 1500));
          current = await readPlan(client, n, address, signer);
        }
        if (current.steps.some((s) => !s.done && confirmed.current.has(s.key))) {
          throw new Error("The network hasn't caught up with your last transaction yet. Wait a few seconds and tap Continue.");
        }
        if (current.problem) throw new Error(current.problem);
        if (current.busy) throw new Error("A transaction from this wallet is still pending. Wait a few seconds and tap Continue.");
        const index = current.steps.findIndex((s) => !s.done);
        if (index < 0) break;
        const step = current.steps[index];
        setRunning(`${step.label} (${index + 1} of ${current.steps.length})…`);
        const hash = await sendTransactionAsync({ to: step.tx.to, data: step.tx.data, chainId: n.chain.id });
        setTxs((t) => [...t, hash]);
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`"${step.label}" reverted (transaction ${hash}).`);
        confirmed.current.add(step.key);
      }
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      busy.current = false;
      setRunning(null);
      void plan.refetch();
    }
  }

  const groups = p ? (["pons", "splitearn"] as const).filter((g) => p.steps.some((s) => s.group === g)) : [];

  return (
    <div className="space-y-4 text-[14px]">
      <p className="text-ink-2">
        Owner: <span className="num break-all text-ink">{address}</span>
        {balance.data ? <span className="ml-1">· {formatEther(balance.data.value).slice(0, 8)} ETH</span> : null}
      </p>
      <p className="leading-relaxed text-ink-2">
        This wallet will own everything it deploys: it can pause launches and claims, withdraw SplitEarn&apos;s share of the fees and replace the signing key. Use the
        wallet you want to keep in charge.
      </p>
      {n.ponsIsCopy && takesEth.data === false ? (
        <p className="rounded-2xl bg-down-soft px-4 py-3 font-medium leading-relaxed text-down-ink">
          This wallet refuses plain ETH transfers (it has delegated code). On testnet it receives every pons launch fee, so launches would fail. Use another
          wallet.
        </p>
      ) : null}

      {!p ? (
        <p className="text-ink-2">{plan.isError ? `Couldn't read the chain yet (${errorMessage(plan.error)}). Retrying…` : "Reading the chain…"}</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g}>
              <div className="eyebrow mb-2">{g === "pons" ? "pons, SplitEarn's copy (testnet only)" : "SplitEarn"}</div>
              <ol className="space-y-1.5">
                {p.steps
                  .filter((s) => s.group === g)
                  .map((s) => (
                    <li key={s.key} className="flex items-start gap-2">
                      <span className={`mt-px shrink-0 ${s.done ? "text-up-ink" : "text-ink-3"}`} aria-hidden>
                        {s.done ? "✓" : "○"}
                      </span>
                      <span className={s.done ? "" : "text-ink-2"}>{s.label}</span>
                    </li>
                  ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {p && left === 0 ? (
        <Pin n={n} plan={p} />
      ) : p ? (
        <>
          {empty ? (
            <p className="font-medium text-down-ink">
              This wallet has no ETH on {n.chain.name}. Add a little for gas first
              {n.faucet ? (
                <>
                  {" "}
                  (
                  <a className="underline" href={n.faucet} target="_blank" rel="noreferrer">
                    faucet
                  </a>
                  )
                </>
              ) : null}
              .
            </p>
          ) : null}
          <button className="btn-sticker" disabled={Boolean(running) || empty || takesEth.data === false} onClick={run}>
            {running ?? (left === p.steps.length ? `Deploy (${left} transactions)` : `Continue (${left} left)`)}
          </button>
          <p className="text-[12px] leading-relaxed text-ink-3">
            Your wallet asks you to confirm each transaction. You can stop at any point and come back later: this page picks up where you left off.
          </p>
        </>
      ) : null}
      {err ? <p className="text-[13px] text-down-ink">{err}</p> : null}
      {txs.length ? (
        <ul className="space-y-1 text-[12px] text-ink-2">
          {txs.map((t) => (
            <li key={t}>
              <a className="num underline" href={explorerLink(n, "tx", t)} target="_blank" rel="noreferrer">
                {t.slice(0, 18)}…
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Everything is deployed: what to pin so the site uses it. */
function Pin({ n, plan }: { n: Network; plan: Plan }) {
  const a = plan.addresses;
  const net = n.id.toUpperCase();
  const json = JSON.stringify(
    {
      [n.id]: {
        launcher: a.launcher,
        feeVault: a.feeVault,
        ...(n.ponsIsCopy ? { ponsFactory: a.ponsFactory } : {}),
        deployedAt: new Date().toISOString().slice(0, 10),
        hidden: [],
      },
    },
    null,
    2
  );
  const env = [`NEXT_PUBLIC_${net}_LAUNCHER_ADDRESS=${a.launcher}`, `NEXT_PUBLIC_${net}_FEE_VAULT_ADDRESS=${a.feeVault}`]
    .concat(n.ponsIsCopy ? [`NEXT_PUBLIC_TESTNET_PONS_FACTORY=${a.ponsFactory}`] : [])
    .join("\n");
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-card-2 p-4">
      <h3 className="text-[16px] font-semibold">Deployed. Last step: point the site at it</h3>
      <p className="leading-relaxed text-ink-2">
        The site starts using these contracts once it&apos;s rebuilt with them. Either commit them to <code className="num">src/deployment.json</code> (the
        maintainer can do it from the addresses below), or add the variables on your host (Vercel: Settings → Environment Variables) and redeploy.
      </p>
      <Copyable label="src/deployment.json" text={json} />
      <Copyable label="or environment variables" text={env} />
    </div>
  );
}

function Copyable({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="eyebrow">{label}</span>
        <button
          className="btn-secondary min-h-[32px] px-3 py-1 text-[12px]"
          onClick={() =>
            navigator.clipboard.writeText(text).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => {}
            )
          }
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="num overflow-x-auto whitespace-pre rounded-xl bg-card p-3 text-[11.5px] leading-relaxed">{text}</pre>
    </div>
  );
}

/** The live network: the "you're live" card and the owner's switches. */
function Live({ n, server }: { n: Network; server: ServerConfig | undefined }) {
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = clientFor(n);
  const launcher = { address: n.launcher!, abi: launcherAbi, chainId: n.chain.id } as const;
  const vault = { address: n.feeVault!, abi: feeVaultAbi, chainId: n.chain.id } as const;
  const { data, refetch } = useReadContracts({
    contracts: [
      { ...launcher, functionName: "owner" },
      { ...launcher, functionName: "launchesPaused" },
      { ...launcher, functionName: "platformFees" },
      { ...launcher, functionName: "platformShareBps" },
      { ...vault, functionName: "owner" },
      { ...vault, functionName: "claimsPaused" },
      { ...vault, functionName: "signer" },
      { ...vault, functionName: "isLauncher", args: [n.launcher!] },
      { ...launcher, functionName: "totalPlatformFees" },
    ],
    query: { refetchInterval: 20_000 },
  });
  const v = <T,>(i: number) => (data?.[i]?.status === "success" ? (data[i].result as T) : undefined);
  const owner = v<Address>(0);
  const launchesPaused = v<boolean>(1);
  const fees = v<bigint>(2);
  const share = v<number>(3);
  const vaultOwner = v<Address>(4);
  const claimsPaused = v<boolean>(5);
  const vaultSigner = v<Address>(6);
  const wired = v<boolean>(7);
  const total = v<bigint>(8);
  // SplitEarn's share that is still in the coins' splitters: it reaches the launcher when a coin's
  // fees are collected (at every claim, or by the owner here before withdrawing).
  const { data: coins } = useCoins({ includeHidden: true });
  const uncollected = coins?.reduce((a, c) => a + c.platformPending, 0n);
  // The coins most worth collecting, a bounded number per transaction (each costs gas; dust in many
  // coins must never make one too big for a block). Pressing again collects the next ones.
  const toCollectCoins = (coins ?? [])
    .filter((c) => c.feesPending > 1_000_000_000_000n)
    .sort((a, b) => (b.feesPending > a.feesPending ? 1 : b.feesPending < a.feesPending ? -1 : 0))
    .slice(0, 25);
  const toCollect = toCollectCoins.map((c) => c.token);
  // SplitEarn's share still held by older launchers (before an upgrade): withdrawn from each of them.
  const older = n.launchers.slice(1);
  const olderFees = useReadContracts({
    contracts: older.map((address) => ({ address, abi: launcherAbi, chainId: n.chain.id, functionName: "platformFees" }) as const),
    query: { enabled: older.length > 0, refetchInterval: 20_000 },
  });
  const olderReady = older.map((address, i) => ({
    address,
    fees: olderFees.data?.[i]?.status === "success" ? (olderFees.data[i].result as bigint) : 0n,
  }));
  const olderTotal = olderReady.reduce((a, x) => a + x.fees, 0n);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const lock = useRef(false);
  const isOwner = same(address, owner) && same(address, vaultOwner);
  const signerMatches = server?.signer ? same(vaultSigner, server.signer) : undefined;

  async function send(label: string, question: string, write: () => Promise<Hex>) {
    if (lock.current) return;
    if (!window.confirm(question)) return;
    lock.current = true;
    setBusy(label);
    setMsg(null);
    try {
      if (chainId !== n.chain.id) await switchChainAsync({ chainId: n.chain.id });
      const hash = await write();
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted.");
      setMsg({ ok: true, text: `${label}: done.` });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      lock.current = false;
      setBusy(null);
      void refetch();
    }
  }

  const rows: { label: string; state: string; ok: boolean; action?: { text: string; run: () => void } }[] = [
    {
      label: "New launches",
      state: launchesPaused === undefined ? "…" : launchesPaused ? "Paused" : "Open",
      ok: !launchesPaused,
      action:
        launchesPaused === undefined
          ? undefined
          : {
              text: launchesPaused ? "Resume launches" : "Pause launches",
              run: () =>
                send(
                  launchesPaused ? "Resume launches" : "Pause launches",
                  launchesPaused ? "Let people launch new coins again?" : "Stop new launches? Existing coins keep trading on pons.",
                  () => writeContractAsync({ ...launcher, functionName: "setLaunchesPaused", args: [!launchesPaused] })
                ),
            },
    },
    {
      label: "Claims",
      state: claimsPaused === undefined ? "…" : claimsPaused ? "Paused" : "Open",
      ok: !claimsPaused,
      action:
        claimsPaused === undefined
          ? undefined
          : {
              text: claimsPaused ? "Resume claims" : "Pause claims",
              run: () =>
                send(
                  claimsPaused ? "Resume claims" : "Pause claims",
                  claimsPaused ? "Let X accounts claim their fees again?" : "Stop all claims? Balances stay in the vault until you resume.",
                  () => writeContractAsync({ ...vault, functionName: "setClaimsPaused", args: [!claimsPaused] })
                ),
            },
    },
    {
      label: "Signing key",
      state: signerMatches === undefined ? "…" : signerMatches ? "Matches this site" : `FeeVault trusts ${shortAddress(vaultSigner ?? "")}, not this site's key`,
      ok: signerMatches !== false,
      action:
        signerMatches === false && server?.signer
          ? {
              text: "Use this site's key",
              run: () =>
                send("Use this site's key", `Make FeeVault accept signatures from ${server.signer}? Signatures from ${vaultSigner} stop working.`, () =>
                  writeContractAsync({ ...vault, functionName: "setSigner", args: [server.signer!] })
                ),
            }
          : undefined,
    },
    {
      label: "SplitEarn's cut of new coins' creator fee",
      state: share === undefined ? "…" : `${share / 100}% (X accounts get ${100 - share / 100}%). Coins already launched keep theirs.`,
      ok: true,
      action:
        address && isOwner && share !== undefined
          ? {
              text: "Change",
              run: () => {
                const input = window.prompt("SplitEarn's cut of the creator fee for coins launched from now on, in % (0 to 30):", String(share / 100));
                if (input === null) return;
                const pct = Number(input.trim().replace("%", "").replace(",", "."));
                if (!Number.isFinite(pct) || pct < 0 || pct > 30) {
                  setMsg({ ok: false, text: "Enter a percentage from 0 to 30." });
                  return;
                }
                const bps = Math.round(pct * 100);
                void send(
                  "Change SplitEarn's cut",
                  `Take ${bps / 100}% of the creator fee (the X accounts get ${100 - bps / 100}%) on coins launched from now on? Existing coins don't change.`,
                  () => writeContractAsync({ ...launcher, functionName: "setPlatformShareBps", args: [bps] })
                );
              },
            }
          : undefined,
    },
    {
      label: `SplitEarn's share${share !== undefined ? ` (${share / 100}% of the creator fee)` : ""}`,
      state:
        fees === undefined || uncollected === undefined
          ? "…"
          : `${formatEther(fees + olderTotal)} ETH ready${uncollected ? ` + ${formatEther(uncollected)} ETH still in the coins` : ""}${total !== undefined ? ` · ${formatEther(total)} ETH earned in all` : ""}`,
      ok: true,
      action:
        address && isOwner && (fees || uncollected || olderTotal)
          ? {
              text: toCollect.length ? "Collect & withdraw to this wallet" : "Withdraw to this wallet",
              run: () =>
                send(
                  toCollect.length ? "Collect & withdraw to this wallet" : "Withdraw to this wallet",
                  toCollect.length
                    ? `Collect the fees of ${toCollect.length} coin${toCollect.length === 1 ? "" : "s"}, then send all of SplitEarn's share to ${address}? Two transactions.`
                    : `Send ${formatEther((fees ?? 0n) + olderTotal)} ETH to ${address}?`,
                  async () => {
                    // Each coin is collected through the launcher that launched it; a collection that
                    // wouldn't go through never blocks withdrawing what's ready.
                    const byLauncher = new Map<Address, Address[]>();
                    for (const c of toCollectCoins) byLauncher.set(c.launcher, [...(byLauncher.get(c.launcher) ?? []), c.token]);
                    let collectedAny = false;
                    for (const [l, tokens] of byLauncher) {
                      const target = { address: l, abi: launcherAbi, chainId: n.chain.id } as const;
                      const collectable = await client
                        .simulateContract({ account: address, ...target, functionName: "collectMany", args: [tokens] })
                        .then(() => true)
                        .catch(() => false);
                      if (!collectable) continue;
                      const hash = await writeContractAsync({ ...target, functionName: "collectMany", args: [tokens] });
                      const r = await client.waitForTransactionReceipt({ hash });
                      if (r.status !== "success") throw new Error("Collecting the coins' fees reverted.");
                      collectedAny = true;
                    }
                    // Withdraw from every launcher that holds something now (the older ones first).
                    const holders: Address[] = [];
                    for (const l of [...older, n.launcher!]) {
                      const held = await client.readContract({ address: l, abi: launcherAbi, functionName: "platformFees" });
                      if (held > 0n) holders.push(l);
                    }
                    if (!holders.length) {
                      throw new Error(
                        toCollect.length && !collectedAny
                          ? "The coins' fees can't be collected right now (pons may still be releasing them). Try again later."
                          : "Nothing to withdraw yet."
                      );
                    }
                    let last: Hex | undefined;
                    for (const l of holders) {
                      last = await writeContractAsync({ address: l, abi: launcherAbi, chainId: n.chain.id, functionName: "withdrawPlatformFees", args: [address] });
                      if (l !== holders[holders.length - 1]) {
                        const r = await client.waitForTransactionReceipt({ hash: last });
                        if (r.status !== "success") throw new Error("A withdrawal reverted.");
                      }
                    }
                    return last!;
                  }
                ),
            }
          : undefined,
    },
  ];

  return (
    <>
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <GraduatedArt className="h-20 w-20" />
        <h2 className="display text-[26px]">SplitEarn is live on {n.label.toLowerCase()}</h2>
        {wired === false ? (
          <p className="text-[14px] font-medium text-down-ink">The FeeVault doesn&apos;t accept this launcher yet, so launches revert. Finish the deployment above.</p>
        ) : (
          <p className="text-[15px] text-ink-2">Launch the first coin.</p>
        )}
        <Link href="/create" className="btn-sticker">
          Launch a coin
        </Link>
      </div>

      <section className="card p-5 sm:p-6">
        <div className="eyebrow">Owner controls · {n.label}</div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {isOwner
            ? "You're connected with the owner wallet. Each switch is one transaction."
            : owner
              ? `Only the owner wallet (${shortAddress(owner)}) can change these.`
              : "Reading the contracts…"}
        </p>
        <ul className="mt-3 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.label} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium">{r.label}</div>
                <div className={`num text-[12px] ${r.ok ? "text-ink-2" : "text-down-ink"}`}>{r.state}</div>
              </div>
              {r.action && isOwner ? (
                <button className="btn-secondary min-h-[40px] px-4 py-2 text-[13px]" disabled={Boolean(busy)} onClick={r.action.run}>
                  {busy === r.action.text ? "Confirm in your wallet…" : r.action.text}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {!isConnected ? (
          <button className="btn-secondary mt-2 min-h-[40px] px-4 py-2 text-[13px]" onClick={openConnectModal}>
            Connect the owner wallet
          </button>
        ) : null}
        {msg ? (
          <p role="status" className={`mt-3 text-[13px] ${msg.ok ? "text-up-ink" : "text-down-ink"}`}>
            {msg.text}
          </p>
        ) : null}
      </section>
    </>
  );
}

export function KeyGenerator({ problem, onChange }: { problem?: string; onChange: (key: string | null) => void }) {
  const [key, setKey] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => setKey(load()), []);
  let address: string | undefined;
  try {
    address = key ? privateKeyToAccount(key as Hex).address : undefined;
  } catch {
    address = undefined;
  }

  if (!key) {
    return (
      <div className="space-y-3">
        {problem ? <p className="text-[14px] font-medium text-down-ink">{problem} Paste the 64 hex characters of the key (with or without 0x).</p> : null}
        <p className="text-[14px] leading-relaxed text-ink-2">
          The server needs its own signing key. It only signs launches (X username → account) and claims: it never holds funds or owns the contracts, and it is not
          your wallet. Create it here in your browser; it is never sent anywhere.
        </p>
        <button
          className="btn-primary"
          onClick={() => {
            const k = generatePrivateKey();
            save(k);
            setKey(k);
            onChange(k);
          }}
        >
          Generate signing key
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-[14px]">
      <p className="text-ink-2">
        Address <span className="num break-all text-ink">{address}</span>
      </p>
      <div>
        <div className="label">Private key: keep it secret. Paste it only into your host, never into a chat.</div>
        <div className="flex gap-2">
          <input readOnly className="input num text-[12px]" type={shown ? "text" : "password"} value={key} aria-label="Signing private key" />
          <button className="btn-secondary shrink-0 px-3" onClick={() => setShown((v) => !v)}>
            {shown ? "Hide" : "Show"}
          </button>
          <button className="btn-secondary shrink-0 px-3" onClick={() => navigator.clipboard.writeText(key)}>
            Copy
          </button>
        </div>
      </div>
      <p className="text-ink-2">
        Add it to your host as <code className="num rounded bg-card-2 px-1">SIGNER_PRIVATE_KEY</code>, then come back here:
      </p>
      <ul className="list-disc space-y-1 pl-5 text-ink-2">
        <li>
          <a className="font-medium text-ink underline" href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">
            Vercel
          </a>
          : project → <b>Settings</b> → <b>Environment Variables</b> → add and save → <b>Deployments</b> → ⋯ → <b>Redeploy</b>.
        </li>
        <li>
          <a className="font-medium text-ink underline" href="https://dashboard.render.com" target="_blank" rel="noreferrer">
            Render
          </a>
          : your service → <b>Environment</b> → <b>Add</b> → paste → <b>Save, rebuild, and deploy</b>.
        </li>
      </ul>
      <button
        className="text-[12px] text-ink-3 underline"
        onClick={() => {
          save(null);
          setKey(null);
          onChange(null);
        }}
      >
        Forget this key on this device
      </button>
    </div>
  );
}

function StepCard({ n, title, state, children }: { n: number; title: string; state: "todo" | "active" | "done"; children: React.ReactNode }) {
  return (
    <section className={`card p-5 ${state === "todo" ? "opacity-50" : ""}`}>
      <div className="mb-3 flex items-center gap-3">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-outline text-[14px] font-bold text-[#1d1d1f] ${
            state === "done" ? "bg-up" : "bg-lime"
          }`}
        >
          {state === "done" ? "✓" : n}
        </span>
        <h2 className="text-[17px] font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}
