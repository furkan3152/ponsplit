import type { Address, ContractFunctionReturnType, Hex } from "viem";
import type { launcherAbi } from "./abi";

/** A coin as the launcher reports it (registry record + live Pons state), straight from the chain. */
export type LaunchView = ContractFunctionReturnType<typeof launcherAbi, "view", "getLaunch">;

/** Pons's launch phases. */
export type Phase = "curve" | "graduating" | "pool" | "rescued";

export type Recipient = { xId: bigint; handle: string; bps: number };

/** A PonsEarn coin with the numbers every page shows. */
export type Coin = {
  token: Address;
  curve: Address;
  splitter: Address;
  creator: Address;
  poolId: Hex;
  createdAt: number;
  createdBlock: bigint;
  name: string;
  symbol: string;
  /** The logo as launched on Pons (ipfs:// or https://); render only through safeUrl(). */
  logo: string;
  creatorTaxBps: number;
  /** Share of every payout that goes to PonsEarn, in bps. */
  platformBps: number;
  phase: Phase;
  /** Off the curve: graduating, on its pool, or rescued. */
  graduated: boolean;
  /** Pons's current creator fee recipient; anything but the splitter means Pons moved the fees. */
  feeRecipient: Address;
  feesMoved: boolean;
  quoteReserve: bigint;
  tokenReserve: bigint;
  raised: bigint;
  threshold: bigint;
  sellable: bigint;
  /** The curve's virtual ETH (sets the opening price). */
  phantomQuote: bigint;
  /** Coins held back for the pool: the curve closes when only these are left. */
  reservedTokens: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  /** ETH per whole token. */
  price: number;
  /** ETH, fully diluted (Pons coins have a fixed 1B supply). */
  marketCap: number;
  /** 0–100: ETH raised on the curve against the graduation threshold. */
  progress: number;
  /** ETH already credited to the X accounts. */
  feesSplit: bigint;
  /** Creator fees earned but not split yet, before PonsEarn's share. */
  feesPending: bigint;
  recipients: Recipient[];
  handles: string[];
  xIds: bigint[];
};

export type Trade = {
  token: Address;
  kind: "buy" | "sell";
  venue: "curve" | "pool";
  /** Who got the coins (buys) or the ETH (sells); for pool trades through other apps, the app's contract. */
  trader: Address;
  /** ETH paid (buy, fees included) or received (sell, after fees). */
  ethAmount: bigint;
  tokenAmount: bigint;
  /** ETH per whole token this trade executed at. */
  price: number;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
  /** Unix seconds (from the block). */
  timestamp: number;
};
