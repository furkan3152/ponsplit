import { getAddress, type Address, type Chain } from "viem";
import deployment from "../deployment.json";
import { robinhood, robinhoodTestnet } from "./chains";
import copyTerms from "./pons-copy-terms.json";

/**
 * SplitEarn runs on both Robinhood Chain networks at once; visitors switch between them at the top
 * of every page. Mainnet uses the real Pons (ponsfamily.com). Pons has no testnet deployment, so the
 * testnet runs SplitEarn's own copy of Pons's open-source v2 contracts (deployed by the owner from
 * /setup) against the Uniswap v4 contracts that Robinhood Chain testnet shares with mainnet.
 */
export type NetworkId = "mainnet" | "testnet";
export const NETWORK_IDS: readonly NetworkId[] = ["mainnet", "testnet"];
export const NETWORK_COOKIE = "pe-network";

/** The official Pons v2 launch factory on Robinhood Chain mainnet. */
export const PONS_MAINNET_FACTORY: Address = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";

/** Uniswap v4 and Permit2: the same addresses on both Robinhood networks. */
export const UNISWAP = {
  poolManager: getAddress(copyTerms.uniswap.poolManager),
  positionManager: getAddress(copyTerms.uniswap.positionManager),
  permit2: getAddress(copyTerms.uniswap.permit2),
} as const;

type Entry = { launcher?: string; feeVault?: string; ponsFactory?: string; deployedAt?: string; hidden?: string[] };

export type Network = {
  id: NetworkId;
  label: string;
  chain: Chain;
  /** JSON-RPC endpoint; NEXT_PUBLIC_<NETWORK>_RPC_URL overrides it (tests point it at a fork). */
  rpcUrl: string;
  explorer: string;
  /** SplitEarn's contracts, once deployed and pinned (src/deployment.json or NEXT_PUBLIC_* variables). */
  launcher?: Address;
  feeVault?: Address;
  /** The Pons factory coins launch on: Pons's own on mainnet, SplitEarn's copy on testnet. */
  ponsFactory?: Address;
  /** True on testnet, where "Pons" is SplitEarn's own copy of Pons's contracts. */
  ponsIsCopy: boolean;
  /** Coins the site doesn't list (the owner's tests, spam). */
  hidden: readonly Address[];
  faucet?: string;
  isTestnet: boolean;
};

function address(value: string | undefined): Address | undefined {
  try {
    return value?.trim() ? getAddress(value.trim()) : undefined;
  } catch {
    return undefined;
  }
}

function list(values: readonly string[] | string | undefined): Address[] {
  const items = typeof values === "string" ? values.split(",") : (values ?? []);
  return items.map((a) => address(a)).filter((a): a is Address => Boolean(a));
}

const committed = deployment as Partial<Record<NetworkId, Entry>>;

// NEXT_PUBLIC_* variables must be spelled out literally so Next.js can inline them. next.config.mjs
// fails the build on a malformed or half-set pin, so what reaches here is either valid or absent.
export const NETWORKS: Record<NetworkId, Network> = {
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    chain: robinhood,
    rpcUrl: process.env.NEXT_PUBLIC_MAINNET_RPC_URL || robinhood.rpcUrls.default.http[0],
    explorer: robinhood.blockExplorers!.default.url,
    launcher: address(process.env.NEXT_PUBLIC_MAINNET_LAUNCHER_ADDRESS || committed.mainnet?.launcher),
    feeVault: address(process.env.NEXT_PUBLIC_MAINNET_FEE_VAULT_ADDRESS || committed.mainnet?.feeVault),
    ponsFactory: PONS_MAINNET_FACTORY,
    ponsIsCopy: false,
    hidden: [...list(committed.mainnet?.hidden), ...list(process.env.NEXT_PUBLIC_MAINNET_HIDDEN_COINS)],
    isTestnet: false,
  },
  testnet: {
    id: "testnet",
    label: "Testnet",
    chain: robinhoodTestnet,
    rpcUrl: process.env.NEXT_PUBLIC_TESTNET_RPC_URL || robinhoodTestnet.rpcUrls.default.http[0],
    explorer: robinhoodTestnet.blockExplorers!.default.url,
    launcher: address(process.env.NEXT_PUBLIC_TESTNET_LAUNCHER_ADDRESS || committed.testnet?.launcher),
    feeVault: address(process.env.NEXT_PUBLIC_TESTNET_FEE_VAULT_ADDRESS || committed.testnet?.feeVault),
    ponsFactory: address(process.env.NEXT_PUBLIC_TESTNET_PONS_FACTORY || committed.testnet?.ponsFactory),
    ponsIsCopy: true,
    hidden: [...list(committed.testnet?.hidden), ...list(process.env.NEXT_PUBLIC_TESTNET_HIDDEN_COINS)],
    faucet: "https://faucet.testnet.chain.robinhood.com",
    isTestnet: true,
  },
};

/** Whether SplitEarn is live on a network: its contracts are deployed and pinned. */
export const isLive = (n: Network) => Boolean(n.launcher && n.feeVault);

/** Where visitors land: NEXT_PUBLIC_DEFAULT_NETWORK, else mainnet once it's live, else testnet if it is. */
export const DEFAULT_NETWORK: NetworkId =
  process.env.NEXT_PUBLIC_DEFAULT_NETWORK === "mainnet" || process.env.NEXT_PUBLIC_DEFAULT_NETWORK === "testnet"
    ? process.env.NEXT_PUBLIC_DEFAULT_NETWORK
    : isLive(NETWORKS.mainnet) || !isLive(NETWORKS.testnet)
      ? "mainnet"
      : "testnet";

export function parseNetwork(value: unknown): NetworkId | undefined {
  return value === "mainnet" || value === "testnet" ? value : undefined;
}

export const otherNetwork = (id: NetworkId): NetworkId => (id === "mainnet" ? "testnet" : "mainnet");

export function networkByChainId(chainId: number | undefined): Network | undefined {
  return NETWORK_IDS.map((id) => NETWORKS[id]).find((n) => n.chain.id === chainId);
}

export const explorerLink = (n: Network, kind: "address" | "tx" | "token", value: string) => `${n.explorer}/${kind}/${value}`;

export const isHidden = (n: Network, token: string) => n.hidden.some((a) => a.toLowerCase() === token.toLowerCase());

/** A link to a page on a given network: the visitor lands on that network (see middleware.ts). */
export const onNetwork = (path: string, id: NetworkId) => `${path}${path.includes("?") ? "&" : "?"}network=${id}`;
