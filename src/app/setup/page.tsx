"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { formatEther, getContractAddress, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useAccount, useBalance, useDeployContract, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { GraduatedArt } from "@/components/art";
import { feeVaultAbi, launchpadAbi } from "@/lib/abi";
import { activeChain, explorerUrl } from "@/lib/chains";
import { FAUCET_URL, SETUP_MODE } from "@/lib/config";
import { CURVE } from "@/lib/deploy-config";
import { errorMessage, shortAddress } from "@/lib/format";

type Status = {
  error?: string;
  chain: string;
  mode?: "wallet" | "server";
  admin?: `0x${string}`;
  balance?: string;
  nonce?: number;
  vault?: `0x${string}`;
  launchpad?: `0x${string}`;
  vaultDeployed: boolean;
  launchpadDeployed: boolean;
  wired: boolean;
  addressesMatch: boolean;
  done: boolean;
  testnet: boolean;
  ownerTarget?: `0x${string}`;
  owner?: `0x${string}`;
  pendingOwner?: `0x${string}`;
  vaultOwner?: `0x${string}`;
  vaultPendingOwner?: `0x${string}`;
  ownershipDone: boolean;
  ownershipProposed: boolean;
  launchesPaused?: boolean;
  claimsPaused?: boolean;
  pinned: boolean;
  keyProblem?: string;
  problem?: string;
  busy: boolean;
  signer?: `0x${string}`;
  signerMatches?: boolean;
};

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

export default function SetupPage() {
  const { data: s, refetch, isLoading, error } = useQuery({
    queryKey: ["setup"],
    refetchInterval: 6_000,
    retry: 1,
    // Throwing on a failed check keeps the last good status on screen instead of replacing it
    // with an error body (which would look like "no admin key yet").
    queryFn: async () => {
      const res = await fetch("/api/setup");
      const body = (await res.json().catch(() => ({}))) as Status & { error?: string };
      if (!res.ok) throw new Error(body.error || `Status check failed (${res.status})`);
      return body;
    },
  });
  const [deploying, setDeploying] = useState(false);
  const [deployErr, setDeployErr] = useState<string | null>(null);
  const [txs, setTxs] = useState<string[]>([]);
  const [stored, setStored] = useState<string | null>(null);
  useEffect(() => setStored(load()), []);

  // Once the server runs on the key generated here, the browser copy is no longer needed.
  useEffect(() => {
    if (!s?.admin || !stored) return;
    try {
      if (privateKeyToAccount(stored as `0x${string}`).address === s.admin) {
        save(null);
        setStored(null);
      }
    } catch {
      // not a key; leave it for the Forget button
    }
  }, [s?.admin, stored]);

  const funded = s?.balance !== undefined && s.balance !== "0";
  const step = !s?.admin ? 1 : !funded && !s.done ? 2 : !s.done ? 3 : !s.ownershipDone ? 4 : 5;
  const testnet = s?.testnet ?? true;

  async function deploy() {
    setDeploying(true);
    setDeployErr(null);
    try {
      const res = await fetch("/api/setup", { method: "POST" });
      const body = (await res.json()) as { error?: string; txs?: string[] };
      if (!res.ok) throw new Error(body.error || "Setup failed");
      setTxs((t) => [...t, ...(body.txs ?? [])]);
    } catch (e) {
      setDeployErr(errorMessage(e));
    } finally {
      setDeploying(false);
      refetch();
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-4">
      <div>
        <h1 className="font-display text-[40px] font-bold tracking-[-0.03em]">Set up PonSplit</h1>
        <p className="mt-1 text-[15px] text-ink-2">A few taps, all from your phone. Network: {s?.chain ?? "…"}.</p>
      </div>

      {isLoading ? <div className="card h-40 animate-pulse" /> : null}
      {error ? (
        <div className="card space-y-3 p-5 text-[14px]">
          <p className="font-medium text-down-ink">
            {s ? "Couldn't refresh the status; showing the last known state. " : "Couldn't check the setup status. "}
            {errorMessage(error)}
          </p>
          <p className="text-ink-2">This is usually the network RPC being slow or rate-limited. Nothing needs to change on your side.</p>
          <button className="btn-secondary" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      ) : null}
      {s?.problem ? <p className="card p-5 text-[14px] font-medium text-down-ink">{s.problem}</p> : null}
      {stored && !(s && step === 1) ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-[14px]">
          <span className="text-ink-2">An admin private key generated on this device is still saved in this browser.</span>
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

      {/* A configuration problem with no admin in sight: don't offer to generate a key over it. */}
      {s && !(s.problem && !s.admin) && (s.mode ?? SETUP_MODE) === "wallet" ? <WalletSetup s={s} onKey={setStored} /> : null}
      {s && !(s.problem && !s.admin) && (s.mode ?? SETUP_MODE) === "server" ? (
        <>
          <StepCard n={1} title="Create the admin key" state={step > 1 ? "done" : "active"}>
            {step > 1 ? (
              <p className="text-[14px] text-ink-2">
                The server is using admin <span className="num break-all text-ink">{s?.admin}</span>.
              </p>
            ) : (
              <KeyGenerator problem={s.keyProblem} onChange={setStored} />
            )}
          </StepCard>

          <StepCard n={2} title={testnet ? "Get free test ETH" : "Fund the admin address"} state={step > 2 ? "done" : step === 2 ? "active" : "todo"}>
            {s?.admin ? (
              <div className="space-y-3">
                <p className="text-[14px] text-ink-2">
                  {testnet
                    ? "Open the faucet, paste this address and request ETH."
                    : "Send about 0.01 ETH on Robinhood Chain to this address; it pays the gas for deployment and signs nothing else on-chain."}{" "}
                  This page updates by itself.
                  {funded ? <span className="ml-1 font-semibold text-up-ink">Balance: {formatEther(BigInt(s.balance!))} ETH ✓</span> : null}
                </p>
                <CopyField value={s.admin} />
                {!funded && testnet ? (
                  <a className="btn-primary" href={FAUCET_URL} target="_blank" rel="noreferrer">
                    Open faucet ↗
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="text-[14px] text-ink-2">Finish step 1 first.</p>
            )}
          </StepCard>

          <StepCard n={3} title="Deploy the contracts" state={step > 3 ? "done" : step === 3 ? "active" : "todo"}>
            {s?.done ? (
              <ul className="space-y-1 text-[14px]">
                <li>
                  FeeVault{" "}
                  <a className="num break-all underline" href={explorerUrl("address", s.vault!)} target="_blank" rel="noreferrer">
                    {s.vault}
                  </a>
                </li>
                <li>
                  Launchpad{" "}
                  <a className="num break-all underline" href={explorerUrl("address", s.launchpad!)} target="_blank" rel="noreferrer">
                    {s.launchpad}
                  </a>
                </li>
              </ul>
            ) : (
              <div className="space-y-3">
                <p className="text-[14px] text-ink-2">One tap. The server sends three transactions with the admin key (about 20 seconds).</p>
                <button className="btn-sticker" disabled={step !== 3 || deploying || s.busy || Boolean(s.problem)} onClick={deploy}>
                  {deploying ? "Deploying…" : "Deploy contracts"}
                </button>
                {deployErr ? <p className="text-[13px] text-down-ink">{deployErr}</p> : null}
              </div>
            )}
            {txs.length ? (
              <ul className="mt-3 space-y-1 text-[12px] text-ink-2">
                {txs.map((t) => (
                  <li key={t}>
                    <a className="num underline" href={explorerUrl("tx", t)} target="_blank" rel="noreferrer">
                      {t.slice(0, 18)}…
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </StepCard>

          <StepCard n={4} title="Hand ownership to your wallet" state={step > 4 ? "done" : step === 4 ? "active" : "todo"}>
            <Ownership s={s} onDone={() => refetch()} onStart={deploy} busy={deploying} />
          </StepCard>

          {s.done && !s.pinned ? (
            <div className="card p-5">
              <PinAddresses
                vault={s.vault!}
                launchpad={s.launchpad!}
                important={!s.testnet}
                note="Until then the site finds its contracts from the admin key, so changing SIGNER_SEED / SIGNER_PRIVATE_KEY would point it at empty addresses."
              />
            </div>
          ) : null}
          <AfterDeploy s={s} />
        </>
      ) : null}
    </div>
  );
}

/** Pause notices, a signer mismatch, and the "you're live" card, once the contracts are wired. */
function AfterDeploy({ s }: { s: Status }) {
  if (!s.done) return null;
  return (
    <>
      {s.launchesPaused || s.claimsPaused ? (
        <p className="card p-4 text-[14px] font-medium text-down-ink">
          Paused by the owner: {[s.launchesPaused && "new launches", s.claimsPaused && "claims"].filter(Boolean).join(" and ")}.
        </p>
      ) : null}
      {s.signerMatches === false ? (
        <p className="card p-5 text-[14px] font-medium text-down-ink">
          FeeVault accepts signatures from <span className="num break-all">{s.signer}</span>, but this server signs as{" "}
          <span className="num break-all">{s.admin}</span>. Launches and claims fail until the owner calls{" "}
          <code className="num break-all">FeeVault.setSigner({s.admin})</code>, or the previous key is restored.
        </p>
      ) : null}
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <GraduatedArt className="h-20 w-20" />
        <h2 className="font-display text-[26px] font-bold tracking-tight">You&apos;re live 🎉</h2>
        {s.addressesMatch ? (
          <p className="text-[15px] text-ink-2">Everything is set. Launch the first coin.</p>
        ) : (
          <p className="text-[15px] text-down-ink">
            The contracts are deployed, but this build of the site doesn&apos;t point at them yet. Rebuild the site (Vercel: Deployments → ⋯ → Redeploy; Render: Manual Deploy → Deploy latest commit).
          </p>
        )}
        <Link href="/create" className="btn-sticker">
          Launch a coin
        </Link>
      </div>
    </>
  );
}

type Found = {
  /**
   * A FeeVault from this wallet that it owns and that trusts the server's signer: one already
   * wired to one of the wallet's launchpads if there is one, otherwise the newest.
   */
  vault?: Address;
  /** The launchpad that vault is wired to, otherwise the newest of the wallet's launchpads using it. */
  launchpad?: Address;
  wired: boolean;
  /** A transaction from the wallet is still pending, so its next contract address isn't known yet. */
  busy: boolean;
  problem?: string;
};

/** How many of the wallet's most recent transactions to look through for earlier deployments. */
const SCAN = 12;

/**
 * Finds what this wallet already deployed, straight from the chain: contracts are created at
 * addresses derived from the wallet and its nonce, so the last few nonces tell. Nothing is stored
 * in the browser, so a reload, another device or a wallet app switching tabs mid-way can never
 * lead to a second deployment.
 */
async function findDeployment(client: PublicClient, wallet: Address, signer: Address): Promise<Found> {
  const [latest, pending] = await Promise.all([
    client.getTransactionCount({ address: wallet }),
    client.getTransactionCount({ address: wallet, blockTag: "pending" }),
  ]);
  const candidates: Address[] = [];
  for (let n = latest - 1; n >= Math.max(0, latest - SCAN); n--) candidates.push(getContractAddress({ from: wallet, nonce: BigInt(n) }));
  const codes = await Promise.all(candidates.map((address) => client.getCode({ address })));
  const live = candidates.filter((_, i) => codes[i] && codes[i] !== "0x");
  // Each read fails harmlessly on contracts that don't have that function.
  const info = await Promise.all(
    live.map(async (address) => {
      const [owner, vaultSigner, itsVault] = await Promise.all([
        client.readContract({ address, abi: feeVaultAbi, functionName: "owner" }).catch(() => undefined),
        client.readContract({ address, abi: feeVaultAbi, functionName: "signer" }).catch(() => undefined),
        client.readContract({ address, abi: launchpadAbi, functionName: "vault" }).catch(() => undefined),
      ]);
      return { address, owner, vaultSigner, itsVault };
    })
  );
  const mine = info.filter((c) => same(c.owner, wallet));
  // Newest first. If an earlier attempt left extra contracts behind, a vault that is already wired
  // to one of this wallet's launchpads is a complete deployment and wins over a newer, unwired one.
  const vaults = mine.filter((c) => same(c.vaultSigner, signer)).map((c) => c.address);
  const wiredTo = await Promise.all(vaults.map((address) => client.readContract({ address, abi: feeVaultAbi, functionName: "launchpad" })));
  const isMyLaunchpadFor = (lp: string, v: string) => mine.some((c) => same(c.address, lp) && same(c.itsVault, v));
  const pick = Math.max(0, vaults.findIndex((v, i) => isMyLaunchpadFor(wiredTo[i], v)));
  const vault = vaults[pick] as Address | undefined;
  let launchpad: Address | undefined;
  let wired = false;
  let problem: string | undefined;
  if (vault) {
    const w = wiredTo[pick];
    if (isMyLaunchpadFor(w, vault)) {
      launchpad = w;
      wired = true;
    } else {
      launchpad = mine.find((c) => same(c.itsVault, vault))?.address;
      if (w !== zeroAddress) problem = `FeeVault ${vault} is already connected to another launchpad (${w}).`;
    }
  }
  return { vault, launchpad, wired, busy: pending > latest, problem };
}

const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** Setup where the owner deploys from their own wallet (the mainnet default). */
function WalletSetup({ s, onKey }: { s: Status; onKey: (key: string | null) => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const signer = s.admin;
  const found = useQuery({
    queryKey: ["wallet-deployment", address, signer],
    enabled: Boolean(address && signer && publicClient && !s.pinned),
    refetchInterval: 15_000,
    queryFn: () => findDeployment(publicClient!, address!, signer!),
  });
  const d = found.data;
  const deployed = Boolean(d?.vault && d.launchpad && d.wired);
  const step = !signer ? 1 : s.pinned ? 4 : deployed ? 3 : 2;

  return (
    <>
      <StepCard n={1} title="Create the signing key" state={step > 1 ? "done" : "active"}>
        {signer ? (
          <p className="text-[14px] text-ink-2">
            The server signs launches and claims as <span className="num break-all text-ink">{signer}</span>. It holds no funds and owns nothing.
          </p>
        ) : (
          <KeyGenerator problem={s.keyProblem} onChange={onKey} walletMode />
        )}
      </StepCard>

      <StepCard n={2} title="Deploy from your wallet" state={step > 2 ? "done" : step === 2 ? "active" : "todo"}>
        {s.pinned ? (
          <ContractList vault={s.vault} launchpad={s.launchpad} owner={s.owner} />
        ) : signer ? (
          <WalletDeploy signer={signer} found={d} checking={found.isLoading} onChange={() => found.refetch()} />
        ) : (
          <p className="text-[14px] text-ink-2">Finish step 1 first.</p>
        )}
      </StepCard>

      <StepCard n={3} title="Point the site at the contracts" state={step > 3 ? "done" : step === 3 ? "active" : "todo"}>
        {s.pinned ? (
          <p className="text-[14px] text-ink-2">This version of the site uses them.</p>
        ) : deployed ? (
          <PinAddresses vault={d!.vault!} launchpad={d!.launchpad!} important note="The site starts using the contracts once it is rebuilt with them." />
        ) : (
          <p className="text-[14px] text-ink-2">After the contracts are deployed.</p>
        )}
      </StepCard>

      <AfterDeploy s={s} />
    </>
  );
}

function ContractList({ vault, launchpad, owner }: { vault?: Address; launchpad?: Address; owner?: Address }) {
  const row = (label: string, value?: Address) =>
    value ? (
      <li>
        {label}{" "}
        <a className="num break-all underline" href={explorerUrl("address", value)} target="_blank" rel="noreferrer">
          {value}
        </a>
      </li>
    ) : null;
  return (
    <ul className="space-y-1 text-[14px]">
      {row("FeeVault", vault)}
      {row("Launchpad", launchpad)}
      {row("Owner", owner)}
    </ul>
  );
}

/** Deploys FeeVault and SplitLaunchpad from the connected wallet and wires them: three transactions. */
function WalletDeploy({ signer, found, checking, onChange }: { signer: Address; found?: Found; checking: boolean; onChange: () => void }) {
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { deployContractAsync } = useDeployContract();
  const { writeContractAsync } = useWriteContract();
  const balance = useBalance({ address, chainId: activeChain.id, query: { enabled: Boolean(address) } });
  const [running, setRunning] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [txs, setTxs] = useState<Hex[]>([]);
  // Set synchronously on the first tap, so a second tap during the first await can't start a
  // second, identical set of deployments.
  const busy = useRef(false);
  // Contracts this page has seen confirmed or found; a later read that misses one of them comes
  // from a node that is behind, and must not lead to deploying it again.
  const seen = useRef<{ vault?: Address; launchpad?: Address }>({});
  if (found?.vault) seen.current.vault ??= found.vault;
  if (found?.launchpad) seen.current.launchpad ??= found.launchpad;

  // Load the contract code while the owner reads the page, not after the tap.
  useEffect(() => {
    void import("@/lib/bytecode");
  }, []);

  if (!isConnected || !address) {
    return (
      <div className="space-y-3">
        <p className="text-[14px] text-ink-2">
          Connect the wallet that should own PonSplit. It deploys both contracts and pays the gas; its key never leaves the wallet. On a phone, open this page in your wallet app&apos;s browser.
        </p>
        <button className="btn-primary" onClick={openConnectModal}>
          Connect wallet
        </button>
      </div>
    );
  }

  const left = found ? Number(!found.vault) + Number(!found.launchpad) + Number(!found.wired) : 3;
  const empty = balance.data?.value === 0n;

  async function run() {
    if (busy.current || !publicClient || !address) return;
    busy.current = true;
    setRunning("Checking…");
    setErr(null);
    try {
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      // Re-read the chain right before sending anything, so nothing is ever deployed twice.
      let f = await findDeployment(publicClient, address, signer);
      if (f.problem) throw new Error(f.problem);
      if (f.busy) throw new Error("A transaction from this wallet is still pending. Wait a few seconds and try again.");
      if ((seen.current.vault && !f.vault) || (seen.current.launchpad && !f.launchpad)) {
        throw new Error("The network hasn't caught up with your last transaction yet. Wait a few seconds and try again.");
      }
      const { feeVaultBytecode, launchpadBytecode } = await import("@/lib/bytecode");
      const confirm = async (hash: Hex) => {
        setTxs((t) => [...t, hash]);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted.`);
        onChange();
        return receipt;
      };
      if (!f.vault) {
        setRunning("Deploying FeeVault (1 of 3)…");
        const r = await confirm(await deployContractAsync({ abi: feeVaultAbi, bytecode: feeVaultBytecode, args: [address, signer], chainId: activeChain.id }));
        if (!r.contractAddress) throw new Error("FeeVault deployment returned no address.");
        seen.current.vault = r.contractAddress;
        f = { ...f, vault: r.contractAddress };
      }
      if (!f.launchpad) {
        setRunning("Deploying the launchpad (2 of 3)…");
        const r = await confirm(await deployContractAsync({ abi: launchpadAbi, bytecode: launchpadBytecode, args: [address, f.vault!, CURVE], chainId: activeChain.id }));
        if (!r.contractAddress) throw new Error("Launchpad deployment returned no address.");
        seen.current.launchpad = r.contractAddress;
        f = { ...f, launchpad: r.contractAddress };
      }
      if (!f.wired) {
        setRunning("Connecting them (3 of 3)…");
        await confirm(await writeContractAsync({ address: f.vault!, abi: feeVaultAbi, functionName: "setLaunchpad", args: [f.launchpad!], chainId: activeChain.id }));
      }
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      busy.current = false;
      setRunning(null);
      onChange();
    }
  }

  return (
    <div className="space-y-3 text-[14px]">
      <p className="text-ink-2">
        Owner: <span className="num break-all text-ink">{address}</span>
        {balance.data ? <span className="ml-1">· {formatEther(balance.data.value).slice(0, 8)} ETH</span> : null}
      </p>
      <p className="text-ink-2">
        This wallet will own both contracts: it can pause launches and claims, change fees within the hard limits and replace the signing key. Use the wallet you want to keep in charge.
      </p>
      <ul className="space-y-1">
        <Progress done={Boolean(found?.vault)} label="FeeVault" value={found?.vault} />
        <Progress done={Boolean(found?.launchpad)} label="Launchpad" value={found?.launchpad} />
        <Progress done={Boolean(found?.wired)} label="Connected to each other" />
      </ul>
      {left > 0 ? (
        <>
          {empty ? <p className="font-medium text-down-ink">This wallet has no ETH on {activeChain.name}. Add a little for gas first.</p> : null}
          <button className="btn-sticker" disabled={Boolean(running) || checking || empty} onClick={run}>
            {running ?? (checking ? "Checking…" : left === 3 ? "Deploy (3 transactions)" : `Continue (${left} left)`)}
          </button>
        </>
      ) : null}
      {err ? <p className="text-[13px] text-down-ink">{err}</p> : null}
      {txs.length ? (
        <ul className="space-y-1 text-[12px] text-ink-2">
          {txs.map((t) => (
            <li key={t}>
              <a className="num underline" href={explorerUrl("tx", t)} target="_blank" rel="noreferrer">
                {t.slice(0, 18)}…
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Progress({ done, label, value }: { done: boolean; label: string; value?: Address }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className={done ? "text-up-ink" : "text-ink-3"}>{done ? "✓" : "○"}</span>
      <span className={done ? "" : "text-ink-2"}>{label}</span>
      {value ? (
        <a className="num break-all text-[12px] underline" href={explorerUrl("address", value)} target="_blank" rel="noreferrer">
          {value}
        </a>
      ) : null}
    </li>
  );
}

/**
 * Pinning the addresses tells the site which contracts to use. In server mode it otherwise derives
 * them from the admin key, so pinning lets that key be rotated (MAINNET.md) without moving the site.
 */
function PinAddresses({ vault, launchpad, important, note }: { vault: Address; launchpad: Address; important: boolean; note: string }) {
  const lines = `NEXT_PUBLIC_FEE_VAULT_ADDRESS=${vault}\nNEXT_PUBLIC_LAUNCHPAD_ADDRESS=${launchpad}`;
  return (
    <div className="space-y-3 text-[14px]">
      <h3 className="text-[16px] font-semibold">{important ? "Important: pin the contract addresses" : "Recommended: pin the contract addresses"}</h3>
      <p className="text-ink-2">
        Add these two environment variables on your host (Vercel: Settings → Environment Variables) and redeploy, or commit them to{" "}
        <code className="num">src/deployment.json</code>. {note}
      </p>
      <pre className="num overflow-x-auto whitespace-pre rounded-2xl bg-card-2 p-4 text-[12px]">{lines}</pre>
      <button className="btn-secondary px-3 py-2 text-[13px]" onClick={() => navigator.clipboard.writeText(lines)}>
        Copy
      </button>
    </div>
  );
}

/** Two-step transfer: the server proposes OWNER_ADDRESS, that wallet accepts here. */
function Ownership({ s, onDone, onStart, busy }: { s?: Status; onDone: () => void; onStart: () => void; busy: boolean }) {
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { writeContractAsync } = useWriteContract();
  const [accepting, setAccepting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!s?.done) return <p className="text-[14px] text-ink-2">After the contracts are deployed.</p>;
  if (!s.ownerTarget) {
    return (
      <p className={`text-[14px] ${s.testnet ? "text-ink-2" : "font-medium text-down-ink"}`}>
        {s.testnet ? "Optional on testnet. " : "Strongly recommended on mainnet. "}
        The admin key on the server owns the contracts right now
        {s.owner ? ` (${shortAddress(s.owner)})` : ""}. Set <code className="num rounded bg-card-2 px-1">OWNER_ADDRESS</code> on your host to a wallet you
        control, ideally a multisig, redeploy, and come back here.
      </p>
    );
  }
  if (s.ownershipDone) {
    return (
      <p className="text-[14px] text-ink-2">
        Owned by <span className="num break-all text-ink">{s.owner}</span>. The server key only signs launches and claims.
      </p>
    );
  }
  if (!s.ownershipProposed) {
    return (
      <div className="space-y-3">
        <p className="text-[14px] text-ink-2">
          Propose <span className="num break-all text-ink">{s.ownerTarget}</span> as the owner of both contracts.
        </p>
        <button className="btn-primary" disabled={busy} onClick={onStart}>
          {busy ? "Proposing…" : "Propose new owner"}
        </button>
      </div>
    );
  }

  const isTarget = address?.toLowerCase() === s.ownerTarget.toLowerCase();
  // Only contracts still waiting on this wallet, so a half-finished accept can simply be retried.
  const waiting = [
    { addr: s.vault, abi: feeVaultAbi, pending: s.vaultPendingOwner, owner: s.vaultOwner },
    { addr: s.launchpad, abi: launchpadAbi, pending: s.pendingOwner, owner: s.owner },
  ].filter((c) => c.addr && c.pending === s.ownerTarget && c.owner !== s.ownerTarget);
  async function accept() {
    setErr(null);
    if (!isConnected) return openConnectModal?.();
    if (!publicClient || !s?.vault || !s.launchpad) return;
    setAccepting(true);
    try {
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      for (const c of waiting) {
        const hash = await writeContractAsync({ address: c.addr!, abi: c.abi, chainId: activeChain.id, functionName: "acceptOwnership" });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Transaction reverted");
      }
      onDone();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setAccepting(false);
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-[14px] text-ink-2">
        Connect <span className="num break-all text-ink">{s.ownerTarget}</span> and accept.{" "}
        {waiting.length === 2 ? "Two transactions, one per contract." : "One transaction left."}
      </p>
      <button className="btn-sticker" disabled={accepting || (isConnected && !isTarget)} onClick={accept}>
        {!isConnected ? "Connect owner wallet" : !isTarget ? "Switch to the owner wallet" : accepting ? "Accepting…" : "Accept ownership"}
      </button>
      {err ? <p className="text-[13px] text-down-ink">{err}</p> : null}
    </div>
  );
}

function KeyGenerator({ problem, onChange, walletMode = false }: { problem?: string; onChange: (key: string | null) => void; walletMode?: boolean }) {
  const [key, setKey] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => setKey(load()), []);
  let address: string | undefined;
  try {
    address = key ? privateKeyToAccount(key as `0x${string}`).address : undefined;
  } catch {
    address = undefined;
  }

  if (!key) {
    return (
      <div className="space-y-3">
        {problem ? <p className="text-[14px] font-medium text-down-ink">{problem} Paste the 64 hex characters of the key (with or without 0x).</p> : null}
        <p className="text-[14px] text-ink-2">
          {walletMode
            ? "The server needs its own signing key. It only signs launches and claims: it never holds funds or owns the contracts, and it is not your wallet. Create it here in your browser; it is never sent anywhere."
            : "PonSplit needs one key that deploys the contracts and signs launches and claims. A Render Blueprint deploy creates it automatically (SIGNER_SEED). Otherwise create it here in your browser; it is never sent anywhere."}
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
          {walletMode ? "Generate signing key" : "Generate admin key"}
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
          <input readOnly className="input num text-[12px]" type={shown ? "text" : "password"} value={key} aria-label="Admin private key" />
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
          <a className="font-medium text-ink underline" href="https://dashboard.render.com" target="_blank" rel="noreferrer">
            Render
          </a>
          : your service → <b>Environment</b> → <b>Add</b> → paste → <b>Save, rebuild, and deploy</b>.
        </li>
        <li>
          <a className="font-medium text-ink underline" href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">
            Vercel
          </a>
          : project → <b>Settings</b> → <b>Environment Variables</b> → add and save → <b>Deployments</b> → ⋯ → <b>Redeploy</b>.
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

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly className="input num text-[13px]" value={value} aria-label="Admin address" />
      <button
        className="btn-secondary shrink-0 px-3"
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
