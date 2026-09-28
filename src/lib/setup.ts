import "server-only";
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  RawContractError,
  createPublicClient,
  createWalletClient,
  getAddress,
  getContractAddress,
  http,
  isAddress,
  parseEther,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { feeVaultAbi, launchpadAbi } from "./abi";
import { feeVaultBytecode, launchpadBytecode } from "./bytecode";
import { activeChain, rpcUrl } from "./chains";
import { adminKeyProblem } from "./adminKey";
import { ADDRESSES_PINNED, FEE_VAULT_ADDRESS, LAUNCHPAD_ADDRESS } from "./config";
import { signerAccount } from "./signing";

// Keep in sync with contracts/scripts/deploy.js.
const CURVE = {
  virtualEth: parseEther("1.5"),
  virtualToken: parseEther("1073000000"),
  curveSupply: parseEther("793100000"),
  lpSupply: parseEther("206900000"),
} as const;

export type SetupStatus = {
  chain: string;
  admin?: Address;
  balance?: string;
  nonce?: number;
  vault?: Address;
  launchpad?: Address;
  vaultDeployed: boolean;
  launchpadDeployed: boolean;
  wired: boolean;
  /** True when the app's configured addresses are the ones setup checks and deploys. */
  addressesMatch: boolean;
  done: boolean;
  testnet: boolean;
  /** Addresses come from NEXT_PUBLIC_* / src/deployment.json rather than from the admin key. */
  pinned: boolean;
  /** SIGNER_PRIVATE_KEY is set but unusable. */
  keyProblem?: string;
  /** Something on-chain is not what setup expects; setup won't send transactions until it's fixed. */
  problem?: string;
  /** A transaction from the admin key is still pending (another setup run is in flight). */
  busy: boolean;
  /** FeeVault.signer and whether it is this server's key. */
  signer?: Address;
  signerMatches?: boolean;
  /** OWNER_ADDRESS: the wallet that should end up owning both contracts (recommended on mainnet). */
  ownerTarget?: Address;
  /** Launchpad owner / pending owner. */
  owner?: Address;
  pendingOwner?: Address;
  vaultOwner?: Address;
  vaultPendingOwner?: Address;
  /** Both contracts owned by OWNER_ADDRESS (or no OWNER_ADDRESS configured). */
  ownershipDone: boolean;
  /** Every contract not yet owned by OWNER_ADDRESS has it as pending owner. */
  ownershipProposed: boolean;
  launchesPaused?: boolean;
  claimsPaused?: boolean;
};

function ownerTarget(): Address | undefined {
  const v = process.env.OWNER_ADDRESS;
  return v && isAddress(v) ? getAddress(v) : undefined;
}

const transport = () => http(rpcUrl, { fetchOptions: { cache: "no-store" } });
const publicClient = () => createPublicClient({ chain: activeChain, transport: transport() });

const hasCode = (code: Hex | undefined) => Boolean(code && code !== "0x");

/** True when a read failed because the contract rejected it (wrong contract), not because of the network. */
function isRevert(e: unknown): boolean {
  return (
    e instanceof BaseError &&
    Boolean(e.walk((c) => c instanceof ContractFunctionRevertedError || c instanceof ContractFunctionZeroDataError || c instanceof RawContractError))
  );
}
const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** The addresses setup works with: pinned ones if configured, else the admin key's CREATE addresses. */
function targets(admin: Address): { vault: Address; launchpad: Address } {
  if (ADDRESSES_PINNED && FEE_VAULT_ADDRESS && LAUNCHPAD_ADDRESS) return { vault: FEE_VAULT_ADDRESS, launchpad: LAUNCHPAD_ADDRESS };
  return { vault: getContractAddress({ from: admin, nonce: 0n }), launchpad: getContractAddress({ from: admin, nonce: 1n }) };
}

export async function setupStatus(): Promise<SetupStatus> {
  const account = signerAccount();
  const base: SetupStatus = {
    chain: activeChain.name,
    testnet: Boolean(activeChain.testnet),
    vaultDeployed: false,
    launchpadDeployed: false,
    wired: false,
    addressesMatch: false,
    done: false,
    pinned: ADDRESSES_PINNED,
    keyProblem: adminKeyProblem(),
    busy: false,
    ownerTarget: ownerTarget(),
    ownershipDone: false,
    ownershipProposed: false,
  };
  if (!account) return base;

  const client = publicClient();
  const admin = account.address;
  const { vault, launchpad } = targets(admin);
  const [balance, nonce, pendingNonce, vaultCode, launchpadCode] = await Promise.all([
    client.getBalance({ address: admin }),
    client.getTransactionCount({ address: admin }),
    client.getTransactionCount({ address: admin, blockTag: "pending" }),
    client.getCode({ address: vault }),
    client.getCode({ address: launchpad }),
  ]);
  const vaultDeployed = hasCode(vaultCode);
  const launchpadDeployed = hasCode(launchpadCode);
  const addressesMatch = same(LAUNCHPAD_ADDRESS, launchpad) && same(FEE_VAULT_ADDRESS, vault);
  const status: SetupStatus = {
    ...base,
    admin,
    balance: balance.toString(),
    nonce: pendingNonce,
    busy: pendingNonce > nonce,
    vault,
    launchpad,
    vaultDeployed,
    launchpadDeployed,
    addressesMatch,
  };

  // Make sure each address holds the contract we think it does before reading anything else from
  // it (e.g. a second FeeVault could have landed in the launchpad's slot).
  let wiredTo: Address | undefined;
  if (vaultDeployed) {
    try {
      [wiredTo, status.signer] = await Promise.all([
        client.readContract({ address: vault, abi: feeVaultAbi, functionName: "launchpad" }),
        client.readContract({ address: vault, abi: feeVaultAbi, functionName: "signer" }),
      ]);
      status.signerMatches = same(status.signer, admin);
    } catch (e) {
      if (!isRevert(e)) throw e;
      return { ...status, problem: `The contract at ${vault} is not a PonSplit FeeVault.` };
    }
  }
  if (launchpadDeployed) {
    let itsVault: Address | undefined;
    try {
      itsVault = await client.readContract({ address: launchpad, abi: launchpadAbi, functionName: "vault" });
    } catch (e) {
      if (!isRevert(e)) throw e;
    }
    if (!same(itsVault, vault)) {
      return {
        ...status,
        problem: ADDRESSES_PINNED
          ? `The contract at ${launchpad} is not a PonSplit launchpad for ${vault}. Check NEXT_PUBLIC_LAUNCHPAD_ADDRESS / NEXT_PUBLIC_FEE_VAULT_ADDRESS.`
          : `The launchpad address ${launchpad} holds a different contract, so this admin key can't finish setup. Use a fresh admin key.`,
      };
    }
  }
  if (vaultDeployed && wiredTo !== zeroAddress && !same(wiredTo, launchpad)) {
    return { ...status, problem: `FeeVault ${vault} is wired to a different launchpad (${wiredTo}).` };
  }
  status.wired = vaultDeployed && same(wiredTo, launchpad);
  status.done = vaultDeployed && launchpadDeployed && status.wired;

  if (status.done) {
    [status.owner, status.pendingOwner, status.vaultOwner, status.vaultPendingOwner, status.launchesPaused, status.claimsPaused] =
      await Promise.all([
        client.readContract({ address: launchpad, abi: launchpadAbi, functionName: "owner" }),
        client.readContract({ address: launchpad, abi: launchpadAbi, functionName: "pendingOwner" }),
        client.readContract({ address: vault, abi: feeVaultAbi, functionName: "owner" }),
        client.readContract({ address: vault, abi: feeVaultAbi, functionName: "pendingOwner" }),
        client.readContract({ address: launchpad, abi: launchpadAbi, functionName: "launchesPaused" }),
        client.readContract({ address: vault, abi: feeVaultAbi, functionName: "claimsPaused" }),
      ]);
  }
  const target = ownerTarget();
  const settled = (o?: Address, p?: Address) => o === target || p === target;
  status.ownershipDone = status.done && (!target || (status.owner === target && status.vaultOwner === target));
  status.ownershipProposed = status.done && Boolean(target) && settled(status.owner, status.pendingOwner) && settled(status.vaultOwner, status.vaultPendingOwner);
  return status;
}

let inflight: Promise<{ status: SetupStatus; txs: Hex[] }> | null = null;

/**
 * Runs the remaining deployment steps with the admin key. Safe to call repeatedly: each step is
 * chosen from on-chain state and sent with the exact nonce it needs, so a duplicate request can
 * never land a contract at the wrong address, and concurrent calls share one run.
 */
export function runSetup(): Promise<{ status: SetupStatus; txs: Hex[] }> {
  if (!inflight) inflight = doRunSetup().finally(() => (inflight = null));
  return inflight;
}

async function doRunSetup(): Promise<{ status: SetupStatus; txs: Hex[] }> {
  const account = signerAccount();
  if (!account) throw new Error(adminKeyProblem() ?? "No admin key on the server (set SIGNER_PRIVATE_KEY or SIGNER_SEED).");
  const client = publicClient();
  const wallet = createWalletClient({ account, chain: activeChain, transport: transport() });
  const txs: Hex[] = [];

  for (let i = 0; i < 6; i++) {
    const s = await setupStatus();
    if (s.problem) throw new Error(s.problem);
    if (s.busy) throw new Error("A setup transaction is still pending. Wait a few seconds and try again.");
    if (s.done) {
      // Hand ownership to OWNER_ADDRESS (two-step: that wallet accepts on /setup).
      const target = s.ownerTarget;
      if (!target || s.ownershipDone || s.ownershipProposed) return { status: s, txs };
      // Propose on each contract the admin still owns and hasn't proposed yet.
      const pending = [
        { address: s.vault!, abi: feeVaultAbi, owner: s.vaultOwner, pending: s.vaultPendingOwner },
        { address: s.launchpad!, abi: launchpadAbi, owner: s.owner, pending: s.pendingOwner },
      ].filter((c) => c.owner === account.address && c.pending !== target);
      if (pending.length === 0) return { status: s, txs };
      let nonce = s.nonce!;
      for (const c of pending) {
        const hash = await wallet.writeContract({ address: c.address, abi: c.abi, functionName: "transferOwnership", args: [target], nonce: nonce++ });
        txs.push(hash);
        await client.waitForTransactionReceipt({ hash, timeout: 45_000 });
      }
      continue;
    }
    if (s.pinned) {
      throw new Error("This site is pinned to contract addresses that aren't fully set up; /setup only deploys fresh contracts for unpinned sites.");
    }
    if (s.balance === "0") throw new Error(`Fund ${s.admin} with test ETH first.`);

    let hash: Hex;
    if (!s.vaultDeployed) {
      if (s.nonce !== 0) throw new Error("This admin key has been used before. Generate a fresh one for setup.");
      hash = await wallet.deployContract({ abi: feeVaultAbi, bytecode: feeVaultBytecode, args: [account.address, account.address], nonce: 0 });
    } else if (!s.launchpadDeployed) {
      if (s.nonce !== 1) throw new Error("Unexpected account nonce; generate a fresh admin key.");
      hash = await wallet.deployContract({ abi: launchpadAbi, bytecode: launchpadBytecode, args: [account.address, s.vault!, CURVE], nonce: 1 });
    } else {
      hash = await wallet.writeContract({ address: s.vault!, abi: feeVaultAbi, functionName: "setLaunchpad", args: [s.launchpad!], nonce: s.nonce! });
    }
    txs.push(hash);
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 45_000 });
    if (receipt.status !== "success") throw new Error(`Setup transaction ${hash} reverted.`);
  }
  return { status: await setupStatus(), txs };
}
