import { formatUnits } from "viem";
import { curveProgress, spotPrice } from "./format";
import { parseMetadata } from "./metadata";
import type { TokenView } from "./types";

/** Derived numbers every token surface needs. */
export function describe(t: TokenView) {
  const price = spotPrice(t.market.virtualEth, t.market.virtualToken);
  const supply = Number(formatUnits(t.totalSupply, 18));
  return {
    price,
    marketCap: price * supply,
    progress: curveProgress(t.market.realToken, t.curveSupply, t.market.graduated),
    meta: parseMetadata(t.metadata),
  };
}
