import type { Coin } from "./types";

export const SORTS = [
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "mcap", label: "Market cap" },
  { key: "graduated", label: "Graduated" },
] as const;
export type Sort = (typeof SORTS)[number]["key"];

export function sortCoins(list: readonly Coin[], sort: Sort): Coin[] {
  const arr = [...list];
  const age = (c: Coin) => c.createdAt ?? 0;
  switch (sort) {
    case "trending":
      // Furthest along the curve, then the newest: the closest thing to momentum without a trade feed.
      return arr.sort((a, b) => Number(b.graduated) - Number(a.graduated) || b.progress - a.progress || age(b) - age(a));
    case "new":
      return arr.sort((a, b) => age(b) - age(a));
    case "mcap":
      return arr.sort((a, b) => b.marketCap - a.marketCap);
    case "graduated":
      return arr.filter((t) => t.graduated).sort((a, b) => b.marketCap - a.marketCap);
  }
}
