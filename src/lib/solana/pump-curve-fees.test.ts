import assert from "node:assert/strict";
import test from "node:test";
import { pendingCurveCreatorFees, pendingPoolCreatorFees } from "./pump-curve-fees";

function curve(length: number): Buffer {
  const data = Buffer.alloc(length);
  Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]).copy(data);
  return data;
}

test("counts pending curve creator fees without counting protocol fees or trading reserves", () => {
  const data = curve(166);
  data.writeBigUInt64LE(747_375_514n, 32);
  data.writeBigUInt64LE(7_257_043n, 125);
  data.writeBigUInt64LE(29_028_172n, 133);
  assert.equal(pendingCurveCreatorFees(data), 7_257_043n);
  data.writeBigUInt64LE(0n, 125);
  assert.equal(pendingCurveCreatorFees(data), 0n);
});

test("legacy curves and partial tails do not invent unswept creator fees", () => {
  for (const length of [81, 83, 115, 123, 125, 132]) assert.equal(pendingCurveCreatorFees(curve(length)), 0n);
});

test("preserves u64 amounts and rejects unrelated account layouts", () => {
  const data = curve(133);
  data.writeBigUInt64LE(18_446_744_073_709_551_615n, 125);
  assert.equal(pendingCurveCreatorFees(data), 18_446_744_073_709_551_615n);
  assert.throws(() => pendingCurveCreatorFees(Buffer.alloc(166)), /Invalid pump.fun/);
});

test("counts PumpSwap creator fees separately from protocol fees and supports legacy pools", () => {
  const data = Buffer.alloc(287);
  Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]).copy(data);
  data.writeBigUInt64LE(90_000n, 271);
  data.writeBigUInt64LE(30_000n, 279);
  assert.equal(pendingPoolCreatorFees(data), 30_000n);
  assert.equal(pendingPoolCreatorFees(data.subarray(0, 271)), 0n);
  assert.equal(pendingPoolCreatorFees(data.subarray(0, 286)), 0n);
  assert.throws(() => pendingPoolCreatorFees(Buffer.alloc(287)), /Invalid pump.fun pool/);
});
