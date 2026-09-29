import { getAddress, type Address } from "viem";
import deployment from "../deployment.json";

/** SplitEarn's own X account: the only social so far. */
export const X_HANDLE = "SplitEarn";
export const X_URL = `https://x.com/${X_HANDLE}`;

/**
 * The official SplitEarn token (its contract address, "CA") on mainnet, once it's launched:
 * `mainnet.officialToken` in src/deployment.json. Until then the home page says it's coming.
 */
export const OFFICIAL_TOKEN: Address | undefined = (() => {
  const raw = (deployment as { mainnet?: { officialToken?: string } }).mainnet?.officialToken?.trim();
  try {
    return raw ? getAddress(raw) : undefined;
  } catch {
    return undefined;
  }
})();

export const isOfficial = (token: string | undefined) => Boolean(OFFICIAL_TOKEN && token && token.toLowerCase() === OFFICIAL_TOKEN.toLowerCase());
