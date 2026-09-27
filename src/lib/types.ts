import type { ContractFunctionReturnType } from "viem";
import type { launchpadAbi } from "./abi";

export type TokenView = ContractFunctionReturnType<typeof launchpadAbi, "view", "getToken">;
export type TradeRecord = ContractFunctionReturnType<typeof launchpadAbi, "view", "getTrades">[number];
export type RecentTrade = ContractFunctionReturnType<typeof launchpadAbi, "view", "getRecentTrades">[number];
