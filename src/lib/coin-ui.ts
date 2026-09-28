import { safeUrl } from "./metadata";
import type { Coin } from "./types";

/** The coin's logo as launched on pons, when it's a link the site may render (https or ipfs). */
export const coinImage = (c: Pick<Coin, "logo">) => safeUrl(c.logo);

/** Where a coin trades, in a word or two. */
export function venueLabel(c: Pick<Coin, "phase">): string {
  switch (c.phase) {
    case "curve":
      return "bonding curve";
    case "graduating":
      return "graduating";
    case "pool":
      return "Uniswap v4";
    case "rescued":
      return "rescued";
  }
}

/** The short tag next to a coin's progress bar. */
export function progressTag(c: Pick<Coin, "phase">, pctText: string): string {
  return c.phase === "curve" ? `${pctText}%` : c.phase === "pool" ? "Uniswap" : c.phase === "graduating" ? "graduating" : "rescued";
}
