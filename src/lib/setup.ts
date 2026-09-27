import "server-only";
import { createPublicClient, createWalletClient, getAddress, getContractAddress, http, isAddress, parseEther, zeroAddress, type Address, type Hex } from "viem";
import { feeVaultAbi, launchpadAbi } from "./abi";
import { feeVaultBytecode, launchpadBytecode } from "./bytecode";
import { activeChain, rpcUrl } from "./chains";
import { FEE_VAULT_ADDRESS, LAUNCHPAD_ADDRESS } from "./config";
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
  /** True when the app's configured addresses are the ones this admin key deploys. */
  addressesMatch: boolean;
  done: boolean;
  testnet: boolean;
  /** OWNER_ADDRESS: the wallet that should end up owning both contracts (recommended on mainnet). */
  ownerTarget?: Address;
  owner?: Address;
  pendingOwner?: Address;
  ownershipDone: boolean;
  launchesPaused?: boolean;
  claimsPaused?: boolean;
};

function ownerTarget(): Address | undefined {
  const v = process.env.OWNER_ADDRESS;
  return v && isAddress(v) ? getAddress(v) : undefined;
}

const publicClient = () => createPublicClient({ chain: activeChain, transport: http(rpcUrl) });

export async function setupStatus(): Promise<SetupStatus> {
  const account = signerAccount();
  const base = {
    chain: activeChain.name,
    testnet: Boolean(activeChain.testnet),
    vaultDeployed: false,
    launchpadDeployed: false,
    wired: false,
    addressesMatch: false,
    done: false,
    ownerTarget: ownerTarget(),
    ownershipDone: false,
  };
  if (!account) return base;

  const client = publicClient();
  const admin = account.address;
  const vault = getContractAddress({ from: admin, nonce: 0n });
  const launchpad = getContractAddress({ from: admin, nonce: 1n });
  const [balance, nonce, vaultCode, launchpadCode] = await Promise.all([
    client.getBalance({ address: admin }),
    client.getTransactionCount({ address: admin }),
    client.getCode({ address: vault }),
    client.getCode({ address: launchpad }),
  ]);
  const vaultDeployed = Boolean(vaultCode && vaultCode !== "0x");
  const launchpadDeployed = Boolean(launchpadCode && launchpadCode !== "0x");
  const wired = vaultDeployed
    ? (await client.readContract({ address: vault, abi: feeVaultAbi, functionName: "launchpad" })).toLowerCase() === launchpad.toLowerCase()
    : false;
  const addressesMatch = LAUNCHPAD_ADDRESS === launchpad && FEE_VAULT_ADDRESS === vault;

  let owner: Address | undefined;
  let pendingOwner: Address | undefined;
  let launchesPaused: boolean | undefined;
  let claimsPaused: boolean | undefined;
  if (vaultDeployed && launchpadDeployed) {
    [owner, pendingOwner, launchesPaused, claimsPaused] = await Promise.all([
      client.readContract({ address: launchpad, abi: launchpadAbi, functionName: "owner" }),
      client.readContract({ address: launchpad, abi: launchpadAbi, functionName: "pendingOwner" }),
      client.readContract({ address: launchpad, abi: launchpadAbi, functionName: "launchesPaused" }),
      client.readContract({ address: vault, abi: feeVaultAbi, functionName: "claimsPaused" }),
    ]);
  }
  const target = ownerTarget();
  const ownershipDone = !target || owner === target;

  return {
    ...base,
    admin,
    balance: balance.toString(),
    nonce,
    vault,
    launchpad,
    vaultDeployed,
    launchpadDeployed,
    wired,
    addressesMatch,
    done: vaultDeployed && launchpadDeployed && wired,
    owner,
    pendingOwner,
    ownershipDone,
    launchesPaused,
    claimsPaused,
  };
}

/**
 * Runs the remaining deployment steps with the admin key. Safe to call repeatedly: each step is
 * chosen from on-chain state, so a timeout or a double click just resumes where it stopped.
 */
export async function runSetup(): Promise<{ status: SetupStatus; txs: Hex[] }> {
  const account = signerAccount();
  if (!account) throw new Error("No admin key on the server (set SIGNER_PRIVATE_KEY or SIGNER_SEED).");
  const client = publicClient();
  const wallet = createWalletClient({ account, chain: activeChain, transport: http(rpcUrl) });
  const txs: Hex[] = [];

  for (let i = 0; i < 5; i++) {
    const s = await setupStatus();
    if (s.done) {
      // Hand ownership to OWNER_ADDRESS (two-step: that wallet accepts on /setup).
      const target = s.ownerTarget;
      if (!target || s.owner !== account.address || s.pendingOwner === target) return { status: s, txs };
      for (const address of [s.vault!, s.launchpad!]) {
        const abi = address === s.vault ? feeVaultAbi : launchpadAbi;
        const pending = await client.readContract({ address, abi, functionName: "pendingOwner" });
        if (pending === target) continue;
        const hash = await wallet.writeContract({ address, abi, functionName: "transferOwnership", args: [target] });
        txs.push(hash);
        await client.waitForTransactionReceipt({ hash, timeout: 45_000 });
      }
      continue;
    }
    if (s.balance === "0") throw new Error(`Fund ${s.admin} with test ETH first.`);

    let hash: Hex;
    if (!s.vaultDeployed) {
      if (s.nonce !== 0) throw new Error("This admin key has been used before. Generate a fresh one for setup.");
      hash = await wallet.deployContract({ abi: feeVaultAbi, bytecode: feeVaultBytecode, args: [account.address, account.address] });
    } else if (!s.launchpadDeployed) {
      if (s.nonce !== 1) throw new Error("Unexpected account nonce; generate a fresh admin key.");
      hash = await wallet.deployContract({ abi: launchpadAbi, bytecode: launchpadBytecode, args: [account.address, s.vault!, CURVE] });
    } else {
      const current = await client.readContract({ address: s.vault!, abi: feeVaultAbi, functionName: "launchpad" });
      if (current !== zeroAddress) throw new Error("FeeVault is wired to a different launchpad.");
      hash = await wallet.writeContract({ address: s.vault!, abi: feeVaultAbi, functionName: "setLaunchpad", args: [s.launchpad!] });
    }
    txs.push(hash);
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 45_000 });
    if (receipt.status !== "success") throw new Error(`Setup transaction ${hash} reverted.`);
  }
  return { status: await setupStatus(), txs };
}
