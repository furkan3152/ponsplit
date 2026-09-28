import type { Coin } from "./types";

export const SORTS = [
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "mcap", label: "Market cap" },
  { key: "graduated", label: "Graduated" },
] as const;
export type Sort = (typeof SORTS)[number]["key"];

export function sortCoins(list: readonly Coin[], sort: Sort, trades24h: Map<string, number> | undefined): Coin[] {
  const arr = [...list];
  switch (sort) {
    case "trending":
      // Most trades in the last day, then the newest.
      return arr.sort((a, b) => (trades24h?.get(b.token.toLowerCase()) ?? 0) - (trades24h?.get(a.token.toLowerCase()) ?? 0) || b.createdAt - a.createdAt);
    case "new":
      return arr.sort((a, b) => b.createdAt - a.createdAt);
    case "mcap":
      return arr.sort((a, b) => b.marketCap - a.marketCap);
    case "graduated":
      return arr.filter((t) => t.graduated).sort((a, b) => b.marketCap - a.marketCap);
  }
}
