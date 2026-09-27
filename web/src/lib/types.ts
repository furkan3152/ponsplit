import type { ContractFunctionReturnType } from "viem";
import type { launchpadAbi } from "./abi";

export type TokenView = ContractFunctionReturnType<typeof launchpadAbi, "view", "getToken">;
