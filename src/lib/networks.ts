import { getAddress, type Address, type Chain } from "viem";
import deployment from "../deployment.json";
import { robinhood, robinhoodTestnet } from "./chains";
import copyTerms from "./pons-copy-terms.json";
import { rpcList } from "./rpc";

/**
 * SplitEarn runs on both Robinhood Chain networks at once; visitors switch between them at the top
 * of every page. Mainnet uses the real Pons (ponsfamily.com). Pons has no testnet deployment, so the
 * testnet runs SplitEarn's own copy of Pons's open-source v2 contracts (deployed by the owner from
 * /setup) against the Uniswap v4 contracts that Robinhood Chain testnet shares with mainnet.
 */
export type NetworkId = "mainnet" | "testnet";
/**
 * The public site runs on mainnet only (the owner's call, 2026-09-29): no switch, and `?network=testnet`
 * or an old cookie lands on mainnet. The testnet code stays for the fork tests, which turn it on with
 * NEXT_PUBLIC_ENABLE_TESTNET=1 (or by making testnet the default network).
 */
export const TESTNET_ENABLED = process.env.NEXT_PUBLIC_ENABLE_TESTNET === "1" || process.env.NEXT_PUBLIC_DEFAULT_NETWORK === "testnet";
export const NETWORK_IDS: readonly NetworkId[] = TESTNET_ENABLED ? ["mainnet", "testnet"] : ["mainnet"];
export const NETWORK_COOKIE = "pe-network";

/** The official Pons v2 launch factory on Robinhood Chain mainnet. */
export const PONS_MAINNET_FACTORY: Address = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";

/** Uniswap v4 and Permit2: the same addresses on both Robinhood networks. */
export const UNISWAP = {
  poolManager: getAddress(copyTerms.uniswap.poolManager),
  positionManager: getAddress(copyTerms.uniswap.positionManager),
  permit2: getAddress(copyTerms.uniswap.permit2),
} as const;

type Entry = { launcher?: string; previousLaunchers?: string[]; feeVault?: string; ponsFactory?: string; deployedAt?: string; hidden?: string[] };

export type Network = {
  id: NetworkId;
  label: string;
  chain: Chain;
  /**
   * JSON-RPC endpoints, tried in order: NEXT_PUBLIC_<NETWORK>_RPC_URL (a comma list, e.g. a paid
   * provider's domain-restricted URL; tests point it at a fork) and then the public RPC.
   */
  rpcUrls: string[];
  explorer: string;
  /** SplitEarn's contracts, once deployed and pinned (src/deployment.json or NEXT_PUBLIC_* variables). */
  launcher?: Address;
  /**
   * Every SplitEarn launcher whose coins the site shows, the current one (`launcher`, which new coins
   * launch on) first. Older launchers stay listed after an upgrade: their coins keep trading and
   * paying out, and SplitEarn's share in them is still withdrawn from them.
   */
  launchers: readonly Address[];
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

/** The current launcher first, then the older ones (never the current one twice). */
function launchersOf(current: Address | undefined, previous: readonly string[] | undefined): Address[] {
  if (!current) return [];
  return [current, ...list(previous).filter((a) => a.toLowerCase() !== current.toLowerCase())];
}
const mainnetLauncher = address(process.env.NEXT_PUBLIC_MAINNET_LAUNCHER_ADDRESS || committed.mainnet?.launcher);
const testnetLauncher = address(process.env.NEXT_PUBLIC_TESTNET_LAUNCHER_ADDRESS || committed.testnet?.launcher);

// NEXT_PUBLIC_* variables must be spelled out literally so Next.js can inline them. next.config.mjs
// fails the build on a malformed or half-set pin, so what reaches here is either valid or absent.
export const NETWORKS: Record<NetworkId, Network> = {
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    chain: robinhood,
    rpcUrls: rpcList(process.env.NEXT_PUBLIC_MAINNET_RPC_URL, robinhood.rpcUrls.default.http[0]),
    explorer: robinhood.blockExplorers!.default.url,
    launcher: mainnetLauncher,
    // An env-pinned launcher (the fork tests) is a separate deployment: the committed older ones don't belong to it.
    launchers: launchersOf(mainnetLauncher, process.env.NEXT_PUBLIC_MAINNET_LAUNCHER_ADDRESS ? [] : committed.mainnet?.previousLaunchers),
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
    rpcUrls: rpcList(process.env.NEXT_PUBLIC_TESTNET_RPC_URL, robinhoodTestnet.rpcUrls.default.http[0]),
    explorer: robinhoodTestnet.blockExplorers!.default.url,
    launcher: testnetLauncher,
    launchers: launchersOf(testnetLauncher, process.env.NEXT_PUBLIC_TESTNET_LAUNCHER_ADDRESS ? [] : committed.testnet?.previousLaunchers),
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

/** Where visitors land: NEXT_PUBLIC_DEFAULT_NETWORK when it's enabled, else mainnet. */
export const DEFAULT_NETWORK: NetworkId = process.env.NEXT_PUBLIC_DEFAULT_NETWORK === "testnet" && TESTNET_ENABLED ? "testnet" : "mainnet";

/** A network id the site serves; anything else (including testnet while it's off) is undefined. */
export function parseNetwork(value: unknown): NetworkId | undefined {
  return typeof value === "string" && (NETWORK_IDS as readonly string[]).includes(value) ? (value as NetworkId) : undefined;
}

/** The other network, or null while the site serves only one. */
export const otherNetwork = (id: NetworkId): NetworkId | null => (TESTNET_ENABLED ? (id === "mainnet" ? "testnet" : "mainnet") : null);

export function networkByChainId(chainId: number | undefined): Network | undefined {
  return NETWORK_IDS.map((id) => NETWORKS[id]).find((n) => n.chain.id === chainId);
}

export const explorerLink = (n: Network, kind: "address" | "tx" | "token", value: string) => `${n.explorer}/${kind}/${value}`;

export const isHidden = (n: Network, token: string) => n.hidden.some((a) => a.toLowerCase() === token.toLowerCase());

/** A link to a page on a given network: the visitor lands on that network (see middleware.ts). */
export const onNetwork = (path: string, id: NetworkId) => `${path}${path.includes("?") ? "&" : "?"}network=${id}`;
