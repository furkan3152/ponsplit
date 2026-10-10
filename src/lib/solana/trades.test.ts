import assert from "node:assert/strict";
import test from "node:test";
import { Message, MessageV0, MessageV1, PublicKey, type Connection, type VersionedTransactionResponse } from "@solana/web3.js";
import { recentTrades, tradesIn } from "./trades";

const mint = new PublicKey("H2mcB6ux2fSUNBr6xJNhUj3h93NUFcRavY3JkZqHTfAB");
const pump = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
// Actual public mainnet BuyExactQuoteInV3 event, transaction
// 2ccmo3XySazxjfBq7SBEHGZ1Bny6UWmZHEKXe68B4o1o5zgPKEaevcYLY6EbwqBrHLngZCDU2tSDoonPDRZMCtyp.
const event = "2J1rPwKen1YZqucsMsHQ8mpUvts4YBAxzsrzuVe44KqSxaNgY6cimJ8c5dy4dCY66XtSrW9F3BWcBnSwYQTUNZhHuGrsXfiJAjJ55uyAqMyTE1TdLuBVJbLNZdvRyxW3NXodkLj2pfch4M7kVBbUsH65p4BTqUot54cVRXGGHhJC27Xyv9Pdxsy629A7wsZqfR542TTy2evXq6qoLb8A7Fi38732tFPT2TqhVKN1BjtKtc3oJ5RtnYps98xHuEyfcU6Jkgbz7KjuKoWenn8tHcXVEYKesyzPo8QQSHNvjRthKzVmbhEHigpaknKgbDXvT1QuPqfoW6fzq1z58RH71XT2T4aiYeUhq7sudWZfqpmgn5upYKKSFw1VdqQJujx5SgAZWEwut8Pi9SDBRv5DHrGTjpzx7iA2EigxvXMZhQvbDD1ivc422YxJDMrzwDRdiAA6HHzAczqsTsgpqAq8dWMVuD9QAJVdc3rLdJwY6io6mDpvMQDNNroFWpXxNmgwzapoPXkurZFLWKieDCfjEUaC9qPcTxo9qZ1bY5siB9";

function transaction(signature: string, version: "legacy" | 0 | 1 = 1, program = pump): VersionedTransactionResponse {
  const header = { numRequiredSignatures: 0, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 };
  const recentBlockhash = PublicKey.default.toBase58();
  const message = version === "legacy"
    ? new Message({ header, accountKeys: [program.toBase58()], recentBlockhash, instructions: [] })
    : version === 0
      ? new MessageV0({ header, staticAccountKeys: [mint], recentBlockhash, compiledInstructions: [], addressTableLookups: [{ accountKey: PublicKey.default, writableIndexes: [0], readonlyIndexes: [] }] })
      : new MessageV1({ header, staticAccountKeys: [program], recentBlockhash, compiledInstructions: [] });
  return {
    slot: 455289704, blockTime: 1791642739, version,
    transaction: { signatures: [signature], message },
    meta: {
      err: null, fee: 5000, preBalances: [], postBalances: [],
      loadedAddresses: version === 0 ? { writable: [program], readonly: [] } : { writable: [], readonly: [] },
      innerInstructions: [{ index: 0, instructions: [{ programIdIndex: version === 0 ? 1 : 0, accounts: [], data: event }] }],
    },
  };
}

test("decodes real V3 trade events from legacy, v0 lookup and v1 messages", () => {
  for (const version of ["legacy", 0, 1] as const) {
    const [trade] = tradesIn(transaction("real-trade", version), mint.toBase58());
    assert.equal(trade.kind, "buy");
    assert.equal(trade.venue, "curve");
    assert.equal(trade.sol, 750_000_000n);
    assert.equal(trade.tokens, 25_391_741_150_968n);
    assert.equal(trade.creatorFee, 2_222_223n);
    assert.equal(trade.timestamp, 1791642739);
    assert.ok(trade.price > 0);
  }
});

test("ignores failed transactions, another mint and forged program event bytes", () => {
  const failed = transaction("failed");
  failed.meta!.err = { InstructionError: [0, "InvalidArgument"] };
  assert.deepEqual(tradesIn(failed, mint.toBase58()), []);
  assert.deepEqual(tradesIn(transaction("other-mint"), PublicKey.default.toBase58()), []);
  for (const version of ["legacy", 0, 1] as const) {
    assert.deepEqual(tradesIn(transaction("forged", version, PublicKey.default), mint.toBase58()), []);
  }
});

test("reads v1 transactions with bounded individual requests and reuses bodies when polling", async () => {
  let signatures = Array.from({ length: 23 }, (_, i) => `signature-${i}`);
  const requests: string[] = [];
  let active = 0;
  let peak = 0;
  const connection = {
    getSignaturesForAddress: async () => signatures.map(signature => ({ signature, err: null })),
    getTransaction: async (signature: string, config: { maxSupportedTransactionVersion: number; commitment: string }) => {
      assert.equal(config.maxSupportedTransactionVersion, 1);
      assert.equal(config.commitment, "confirmed");
      requests.push(signature);
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return transaction(signature, requests.length % 2 ? 0 : 1);
    },
    getTransactions: () => { throw new Error("PublicNode rejects getTransaction batches"); },
  } as unknown as Connection;
  assert.equal((await recentTrades(connection, mint, true)).length, 23, "curve/pool duplicate signatures count once");
  assert.equal(requests.length, 23);
  assert.ok(peak > 1 && peak <= 4, "individual RPC reads are concurrent with a small upper bound");
  assert.equal((await recentTrades(connection, mint, true)).length, 23);
  assert.equal(requests.length, 23, "polling doesn't refetch historical bodies");
  signatures = ["new-signature", ...signatures];
  assert.equal((await recentTrades(connection, mint, true)).length, 24);
  assert.equal(requests.at(-1), "new-signature");
  assert.equal(requests.length, 24);
});

test("does not cache temporarily missing bodies or turn RPC failure into no trades", async () => {
  let attempt = 0;
  const connection = {
    getSignaturesForAddress: async () => [{ signature: "retry", err: null }],
    getTransaction: async () => {
      attempt++;
      if (attempt === 1) throw new Error("429 Too many requests");
      return attempt === 2 ? null : transaction("retry");
    },
  } as unknown as Connection;
  await assert.rejects(() => recentTrades(connection, mint, false), /429/);
  assert.deepEqual(await recentTrades(connection, mint, false), []);
  assert.equal((await recentTrades(connection, mint, false)).length, 1);
  assert.equal(attempt, 3);
});

test("a failed read retries only missing history and keeps successful concurrent reads", async () => {
  const signatures = Array.from({ length: 5 }, (_, i) => `request-${i}`);
  const requests: string[] = [];
  let refuseOnce = true;
  const connection = {
    getSignaturesForAddress: async () => signatures.map(signature => ({ signature, err: null })),
    getTransaction: async (signature: string) => {
      requests.push(signature);
      if (signature === "request-1" && refuseOnce) {
        refuseOnce = false;
        throw new Error("RPC unavailable");
      }
      return transaction(signature);
    },
  } as unknown as Connection;
  await assert.rejects(() => recentTrades(connection, mint, false), /unavailable/);
  assert.equal((await recentTrades(connection, mint, false)).length, 5);
  assert.deepEqual(requests, ["request-0", "request-1", "request-2", "request-3", "request-1", "request-4"]);
});
