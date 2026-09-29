import assert from "node:assert/strict";
import { test } from "node:test";
import { rpcList } from "./rpc.ts";

const PUBLIC = "https://rpc.mainnet.chain.robinhood.com";

test("the public RPC alone when nothing is configured", () => {
  assert.deepEqual(rpcList(undefined, PUBLIC), [PUBLIC]);
  assert.deepEqual(rpcList(" ", PUBLIC), [PUBLIC]);
});

test("configured RPCs come first, the public one stays as the backup", () => {
  assert.deepEqual(rpcList("https://a.example/k, https://b.example", PUBLIC), ["https://a.example/k", "https://b.example", PUBLIC]);
  assert.deepEqual(rpcList(PUBLIC, PUBLIC), [PUBLIC]);
});

test("a local fork is used alone, never mixed with the real network", () => {
  assert.deepEqual(rpcList("http://127.0.0.1:8545", PUBLIC), ["http://127.0.0.1:8545"]);
  assert.deepEqual(rpcList("http://localhost:8545", PUBLIC), ["http://localhost:8545"]);
});
