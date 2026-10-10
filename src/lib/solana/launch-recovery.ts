import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { ExtensionType, getExtensionData, TOKEN_2022_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import { unpack } from "@solana/spl-token-metadata";
import { feeSharingConfigPda, PUMP_FEE_PROGRAM_ID, PUMP_SDK } from "@pump-fun/pump-sdk";
import { MAINNET_GENESIS_HASH } from "../admin-config";
import { safeUrl } from "../metadata";
import { isValidTikTokHandle, normalizeTikTokHandle } from "../tiktok-config";
import { ALLOWED_PLATFORM_BPS, PLATFORM_BPS } from "./config";
import { tikTokLaunchState, tikTokShareholders } from "./pump";

const MAX_METADATA_BYTES = 32 * 1024;
export type RecoveredLaunch = {
  mint: string;
  symbol: string;
  handle: string;
  launcherBps: number;
  platformBps: number;
  metadataUri: string;
  at: number;
  restored: true;
};

export function recoveryMintMetadata(mint: PublicKey, info: AccountInfo<Buffer> | null) {
  if (!info || info.executable) throw new Error("This mint was not found on Solana mainnet.");
  const parsed = unpackMint(mint, info, TOKEN_2022_PROGRAM_ID);
  const raw = getExtensionData(ExtensionType.TokenMetadata, parsed.tlvData);
  if (!parsed.isInitialized || !raw) throw new Error("This mint has no initialized Token-2022 metadata.");
  const metadata = unpack(raw);
  if (!metadata.mint.equals(mint) || !metadata.name || metadata.name.length > 32 || !/^[A-Za-z0-9]{1,13}$/.test(metadata.symbol)) throw new Error("The mint metadata could not be validated.");
  const url = safeUrl(metadata.uri);
  if (!url) throw new Error("This mint has no usable public metadata URL.");
  const parsedUrl = new URL(url);
  const devLocal = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname);
  if ((parsedUrl.protocol !== "https:" && !(devLocal && parsedUrl.protocol === "http:")) || parsedUrl.username || parsedUrl.password || parsedUrl.hash || (parsedUrl.port && !devLocal)) throw new Error("Recovery requires a public HTTPS metadata URL.");
  return { name: metadata.name, symbol: metadata.symbol, metadataUri: metadata.uri, url };
}

export function recoveryMetadataFields(raw: string, onchain: { name: string; symbol: string }) {
  const metadata = JSON.parse(raw) as Record<string, unknown>;
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object" || metadata.name !== onchain.name || metadata.symbol !== onchain.symbol || typeof metadata.tiktokHandle !== "string") throw new Error("Public coin details do not match the on-chain mint.");
  const handle = normalizeTikTokHandle(metadata.tiktokHandle);
  const launcherBps = metadata.launcherBps;
  const platformBps = metadata.platformBps;
  if (!isValidTikTokHandle(handle) || !Number.isInteger(launcherBps) || (launcherBps as number) < 0 || (launcherBps as number) > 1000 || !Number.isInteger(platformBps) || !ALLOWED_PLATFORM_BPS.has(platformBps as number) || (platformBps === PLATFORM_BPS && launcherBps !== 0)) throw new Error("The saved TikTok username or original fee policy is invalid.");
  return { handle, launcherBps: launcherBps as number, platformBps: platformBps as number };
}

export async function fetchRecoveryMetadata(url: string, fetcher: typeof fetch = fetch): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(url, { signal: controller.signal, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store" });
    const length = response.headers.get("content-length");
    if (!response.ok || !response.body || (length && Number(length) > MAX_METADATA_BYTES)) throw new Error("The public coin metadata is unavailable or too large.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_METADATA_BYTES) { await reader.cancel(); throw new Error("The public coin metadata exceeds the recovery size limit."); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    // Our Blob filenames commit to the exact JSON bytes, even if a URL is overwritten.
    const parsed = new URL(url);
    const committed = /\.public\.blob\.vercel-storage\.com$/.test(parsed.hostname) && /^\/m\/([a-f0-9]{16})$/.exec(parsed.pathname);
    if (committed) {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer));
      const prefix = Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (prefix !== committed[1]) throw new Error("The public coin metadata changed at its original URL. Recovery was blocked.");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally { clearTimeout(timeout); }
}

/** Read-only restoration. The connected original launcher must still approve the final split. */
export async function recoverTikTokLaunch(connection: Connection, mintInput: string, launcher: PublicKey): Promise<{ launch: RecoveredLaunch; state: "needs-split" | "done" }> {
  const mint = new PublicKey(mintInput.trim());
  if ((await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH) throw new Error("Restore launches only from Solana mainnet.");
  const onchain = recoveryMintMetadata(mint, await connection.getAccountInfo(mint, "confirmed"));
  const fields = recoveryMetadataFields(await fetchRecoveryMetadata(onchain.url), onchain);
  tikTokShareholders(fields.handle, launcher, fields.launcherBps, fields.platformBps);
  if (fields.platformBps !== PLATFORM_BPS) {
    const info = await connection.getAccountInfo(feeSharingConfigPda(mint), "confirmed");
    if (!info?.owner.equals(PUMP_FEE_PROGRAM_ID) || !PUMP_SDK.decodeSharingConfig(info).adminRevoked) throw new Error("Historical fee policies may restore only an already finalized split.");
  }
  const state = await tikTokLaunchState(connection, mint, { ...fields, launcher, metadataUri: onchain.metadataUri });
  if (state === "missing") throw new Error("This mint is not confirmed. Check its original transaction receipt before retrying.");
  const launch: RecoveredLaunch = { mint: mint.toBase58(), symbol: onchain.symbol, ...fields, metadataUri: onchain.metadataUri, at: Date.now(), restored: true };
  return { launch, state };
}
