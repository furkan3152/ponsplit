// Official pump IDL, pump-fun/pump-public-docs@2293f9a66c654e9fe82dc5e8f4618538f24bb35f.
// The installed SDK predates the per-curve creator_fee u64 appended at byte 125.
// Older curves have no bucket; their creator fees already live in the creator vault.
const CURVE_DISCRIMINATOR = Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]);
const CREATOR_FEE_OFFSET = 125;
const POOL_DISCRIMINATOR = Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]);
const POOL_CREATOR_FEE_OFFSET = 279;

/** Read only the creator bucket, never protocol fees or the curve's trading reserves. */
export function pendingCurveCreatorFees(data: Buffer): bigint {
  if (!data.subarray(0, 8).equals(CURVE_DISCRIMINATOR)) throw new Error("Invalid pump.fun bonding curve account.");
  return data.length >= CREATOR_FEE_OFFSET + 8 ? data.readBigUInt64LE(CREATOR_FEE_OFFSET) : 0n;
}

/** Canonical SOL PumpSwap pools keep their unswept creator fees after protocol_fees. */
export function pendingPoolCreatorFees(data: Buffer): bigint {
  if (!data.subarray(0, 8).equals(POOL_DISCRIMINATOR)) throw new Error("Invalid pump.fun pool account.");
  return data.length >= POOL_CREATOR_FEE_OFFSET + 8 ? data.readBigUInt64LE(POOL_CREATOR_FEE_OFFSET) : 0n;
}
