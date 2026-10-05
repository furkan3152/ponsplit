import { OFFICIAL_TOKEN as OFFICIAL } from "./solana/config";

/** Splidev's own accounts. Empty until the owner creates them (the links hide themselves). */
export const X_HANDLE = "";
export const X_URL = X_HANDLE ? `https://x.com/${X_HANDLE}` : "";
export const NAME = "Splidev";

/** The official Splidev token (its mint, "CA"), once launched: `officialToken` in src/splidev.json. */
export const OFFICIAL_TOKEN = OFFICIAL?.toBase58();

export const isOfficial = (token: string | undefined) => Boolean(OFFICIAL_TOKEN && token === OFFICIAL_TOKEN);
