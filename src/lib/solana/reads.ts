// Reading Splitdev coins from Solana. There is no Splitdev registry: a Splitdev coin is a pump.fun coin
// whose fee sharing is final (admin revoked) and lists Splitdev's treasury first. pump.fun's fee
// program keeps that list in one account per coin, so one getProgramAccounts call finds them all.
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ExtensionType, TOKEN_2022_PROGRAM_ID, getExtensionData, unpackAccount, unpackMint } from "@solana/spl-token";
import { unpack as unpackMetadata } from "@solana/spl-token-metadata";
import { PUMP_SDK, bondingCurvePda, creatorVaultPda, socialFeePda, Platform } from "@pump-fun/pump-sdk";
import { canonicalPumpPoolPda, coinCreatorVaultAtaPda, coinCreatorVaultAuthorityPda, PUMP_AMM_SDK } from "@pump-fun/pump-swap-sdk";
import { ALLOWED_PLATFORM_BPS, HIDDEN, SHARES_TOTAL, TREASURY } from "./config";
import { PUMP_FEES_PROGRAM_ID } from "./pump";

/** One GitHub account's part of a coin's creator fees. */
export type Recipient = { githubId: string; feeAccount: string; /** of all creator fees, in bps */ shareBps: number };

export type Coin = {
  /** The mint. */
  token: string;
  name: string;
  symbol: string;
  /** The metadata JSON's URL. */
  uri: string;
  creator: string;
  /** Splitdev's part of the creator fees, in bps. */
  platformBps: number;
  recipients: Recipient[];
  /** Off the curve: pump.fun moved it to its pool. */
  graduated: boolean;
  /** SOL per whole token. */
  price: number;
  /** SOL, on the 1B supply. */
  marketCap: number;
  /** 0-100: how much of the curve's tokens are sold. */
  progress: number;
  /** SOL in the curve (or the pool's SOL side once graduated). */
  liquiditySol: number;
  /** Creator fees waiting to be distributed (curve vault), in lamports. */
  pendingFees: bigint;
};

const LAMPORTS = 1e9;
const TOKEN_UNITS = 1e6;
// Anchor account discriminators: sha256("account:<Name>")[0..8].
const SHARING_CONFIG_DISC = Buffer.from([216, 74, 9, 0, 56, 140, 93, 75]);
/** Where the first shareholder's address sits in pump.fun's SharingConfig account. */
const FIRST_SHAREHOLDER_OFFSET = 80;
const SOCIAL_FEE_PDA_DISC = Buffer.from([139, 96, 53, 17, 42, 169, 206, 150]);
/** The curve's starting real token reserves (pump.fun's global config), for the progress bar. */
const INITIAL_REAL_TOKENS = 793_100_000 * TOKEN_UNITS;

type Sharing = { mint: PublicKey; config: PublicKey; /** the wallet that launched the coin and set the split */ admin: PublicKey; shareholders: { address: PublicKey; shareBps: number }[] };

/** Every Splitdev coin's fee sharing: pump.fun SharingConfig accounts that list `treasury` first and are final. */
export async function findSharings(c: Connection, treasury: PublicKey | null = TREASURY): Promise<Sharing[]> {
  if (!treasury) return [];
  const accounts = await c.getProgramAccounts(PUMP_FEES_PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: encode58(SHARING_CONFIG_DISC) } },
      { memcmp: { offset: FIRST_SHAREHOLDER_OFFSET, bytes: treasury.toBase58() } },
    ],
  });
  const out: Sharing[] = [];
  for (const a of accounts) {
    const cfg = PUMP_SDK.decodeSharingConfig(a.account);
    // status byte (after the discriminator, bump and version): 1 = Active, 0 = Paused.
    if (!cfg.adminRevoked || a.account.data[10] !== 1) continue;
    if (HIDDEN.has(cfg.mint.toBase58())) continue;
    out.push({ mint: cfg.mint, config: a.pubkey, admin: cfg.admin, shareholders: cfg.shareholders.map((s: { address: PublicKey; shareBps: number }) => ({ address: s.address, shareBps: s.shareBps })) });
  }
  return out;
}

// base58 for short byte strings (the 8-byte discriminator), as getProgramAccounts filters want.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function encode58(bytes: Uint8Array): string {
  let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0"));
  let s = "";
  while (n > 0n) {
    s = ALPHABET[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}

/** The GitHub user id behind a pump.fun GitHub fee account, from the account itself (null if it's anything else). */
export function githubIdOf(info: AccountInfo<Buffer> | null): string | null {
  if (!info || !info.owner.equals(PUMP_FEES_PROGRAM_ID) || !info.data.subarray(0, 8).equals(SOCIAL_FEE_PDA_DISC)) return null;
  const pda = PUMP_SDK.decodeSocialFeePda(info);
  return pda.platform === Platform.GitHub ? pda.userId : null;
}

function metadataOf(info: AccountInfo<Buffer> | null, mint: PublicKey) {
  if (!info) return null;
  try {
    const m = unpackMint(mint, info, TOKEN_2022_PROGRAM_ID);
    const data = getExtensionData(ExtensionType.TokenMetadata, m.tlvData);
    if (!data) return null;
    const md = unpackMetadata(data);
    return { name: md.name, symbol: md.symbol, uri: md.uri };
  } catch {
    return null;
  }
}

/** Reads the coins behind `sharings`: their curve or pool, metadata, recipients and pending fees. */
export async function readCoins(c: Connection, sharings: Sharing[]): Promise<Coin[]> {
  if (!sharings.length) return [];
  // GitHub ids: each GitHub shareholder is a pump.fun fee account that records its user id.
  const shareholderKeys = Array.from(new Set(sharings.flatMap((s) => s.shareholders.map((h) => h.address.toBase58())))).map((k) => new PublicKey(k));
  const holderInfos = await many(c, shareholderKeys);
  const githubOf = new Map<string, string>();
  holderInfos.forEach((info, i) => {
    const id = githubIdOf(info);
    if (id) githubOf.set(shareholderKeys[i].toBase58(), id);
  });

  const curves = sharings.map((s) => bondingCurvePda(s.mint));
  const vaults = sharings.map((s) => creatorVaultPda(s.config));
  const [mintInfos, curveInfos, vaultInfos] = await Promise.all([many(c, sharings.map((s) => s.mint)), many(c, curves), many(c, vaults)]);
  const rent = await c.getMinimumBalanceForRentExemption(0);

  const coins: Coin[] = [];
  const graduated: number[] = [];
  sharings.forEach((s, i) => {
    const md = metadataOf(mintInfos[i], s.mint);
    const curveInfo = curveInfos[i];
    if (!md || !curveInfo) return;
    const curve = PUMP_SDK.decodeBondingCurve(curveInfo);
    // Only what Splitdev's own launch makes is a Splitdev coin, so nobody can dress a coin up as one
    // (fee sharing can be set by anyone): Splitdev's share first, every other shareholder a pump.fun
    // GitHub fee account (no hidden wallet taking a cut), a plain SOL curve, no mayhem or cashback mode.
    const treasuryShare0 = s.shareholders[0]?.shareBps ?? 0;
    if (!ALLOWED_PLATFORM_BPS.has(treasuryShare0)) return;
    if (s.shareholders.length < 2 || !s.shareholders.slice(1).every((h) => githubOf.has(h.address.toBase58()))) return;
    if (curve.isMayhemMode || curve.isCashbackCoin) return;
    if (curve.quoteMint && !curve.quoteMint.equals(NATIVE_MINT) && !curve.quoteMint.equals(PublicKey.default)) return;
    const vt = Number(curve.virtualTokenReserves.toString());
    const vs = Number(curve.virtualQuoteReserves.toString());
    const rt = Number(curve.realTokenReserves.toString());
    const supply = Number(curve.tokenTotalSupply.toString()) || 1e15;
    const price = vt > 0 ? vs / LAMPORTS / (vt / TOKEN_UNITS) : 0;
    const treasuryShare = s.shareholders[0]?.shareBps ?? 0;
    const recipients: Recipient[] = s.shareholders.slice(1).flatMap((h) => {
      const id = githubOf.get(h.address.toBase58());
      return id ? [{ githubId: id, feeAccount: h.address.toBase58(), shareBps: h.shareBps }] : [];
    });
    const vault = vaultInfos[i]?.lamports ?? 0;
    coins.push({
      token: s.mint.toBase58(),
      name: md.name,
      symbol: md.symbol,
      uri: md.uri,
      // The launching wallet: the curve's creator becomes the fee sharing config once the split is set.
      creator: s.admin.toBase58(),
      platformBps: treasuryShare,
      recipients,
      graduated: curve.complete,
      price,
      marketCap: price * (supply / TOKEN_UNITS),
      progress: curve.complete ? 100 : Math.max(0, Math.min(100, 100 * (1 - rt / INITIAL_REAL_TOKENS))),
      liquiditySol: Number(curve.realQuoteReserves.toString()) / LAMPORTS,
      pendingFees: BigInt(Math.max(0, vault - rent)),
    });
    if (curve.complete) graduated.push(coins.length - 1);
  });

  // Graduated coins trade on pump.fun's pool: price from its reserves, and creator fees also pile up
  // in the pool's creator vault (wrapped SOL owned by the coin's creator, here its sharing config),
  // which a distribution sweeps too, so they count as waiting.
  if (graduated.length) {
    const configOf = new Map(sharings.map((s) => [s.mint.toBase58(), s.config]));
    const poolVaults = graduated.map((i) => coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(configOf.get(coins[i].token)!), NATIVE_MINT, TOKEN_PROGRAM_ID));
    const poolVaultInfos = await many(c, poolVaults);
    graduated.forEach((i, j) => {
      coins[i].pendingFees += BigInt(tokenAmount(poolVaultInfos[j], poolVaults[j]));
    });
    const pools = await many(c, graduated.map((i) => canonicalPumpPoolPda(new PublicKey(coins[i].token))));
    const decoded = pools.map((p) => (p ? PUMP_AMM_SDK.decodePoolNullable(p) : null));
    const reserves = await many(c, decoded.flatMap((p) => (p ? [p.poolBaseTokenAccount, p.poolQuoteTokenAccount] : [])));
    let r = 0;
    decoded.forEach((p, j) => {
      if (!p) return;
      const base = tokenAmount(reserves[r++], p.poolBaseTokenAccount);
      const quote = tokenAmount(reserves[r++], p.poolQuoteTokenAccount);
      // pump.fun's pools price with virtual SOL on top of the real reserve.
      const effectiveQuote = quote + Number(p.virtualQuoteReserves?.toString() ?? 0);
      const coin = coins[graduated[j]];
      if (base > 0) {
        coin.price = effectiveQuote / LAMPORTS / (base / TOKEN_UNITS);
        coin.marketCap = coin.price * 1e9;
        coin.liquiditySol = quote / LAMPORTS;
      }
    });
  }
  return coins;
}

function tokenAmount(info: AccountInfo<Buffer> | null, address: PublicKey): number {
  if (!info) return 0;
  try {
    return Number(unpackAccount(address, info, info.owner).amount);
  } catch {
    return 0;
  }
}

/** getMultipleAccountsInfo in pages of 100 (the RPC's limit). */
export async function many(c: Connection, keys: PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]> {
  const out: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < keys.length; i += 100) out.push(...(await c.getMultipleAccountsInfo(keys.slice(i, i + 100), "confirmed")));
  return out;
}

/** Every Splitdev coin, read fresh from the chain. */
export async function listCoins(c: Connection): Promise<Coin[]> {
  return readCoins(c, await findSharings(c));
}

/** One coin, or null when the mint isn't a Splitdev coin. */
export async function readCoin(c: Connection, mint: PublicKey): Promise<Coin | null> {
  if (!TREASURY) return null;
  const [cfgKey] = [feeSharingConfig(mint)];
  const info = await c.getAccountInfo(cfgKey, "confirmed");
  if (!info) return null;
  const cfg = PUMP_SDK.decodeSharingConfig(info);
  // Final (admin revoked), Active (status byte 1, as findSharings checks), treasury first.
  if (!cfg.adminRevoked || info.data[10] !== 1 || !cfg.shareholders[0]?.address.equals(TREASURY) || HIDDEN.has(mint.toBase58())) return null;
  const [coin] = await readCoins(c, [{ mint, config: cfgKey, admin: cfg.admin, shareholders: cfg.shareholders }]);
  return coin ?? null;
}

function feeSharingConfig(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("sharing-config"), mint.toBuffer()], PUMP_FEES_PROGRAM_ID)[0];
}

/**
 * What a GitHub account has waiting on pump.fun: the balance of its pump.fun GitHub fee account
 * (claimable on pump.fun after signing in with GitHub), in lamports.
 */
export async function githubClaimable(c: Connection, githubId: string): Promise<{ account: string; claimable: bigint; exists: boolean }> {
  const account = socialFeePda(githubId, Platform.GitHub);
  const info = await c.getAccountInfo(account, "confirmed");
  if (!info) return { account: account.toBase58(), claimable: 0n, exists: false };
  const rent = await c.getMinimumBalanceForRentExemption(info.data.length);
  return { account: account.toBase58(), claimable: BigInt(Math.max(0, info.lamports - rent)), exists: true };
}

export { SHARES_TOTAL };
