import test from "node:test";
import assert from "node:assert/strict";
import { PublicAccountReadError, readPublicProgramAccounts } from "./public-account-reader.ts";
import { PUBLIC_INDEX_RPC } from "./rpc.ts";

const request = { jsonrpc: "2.0", id: "recovery-read", method: "getProgramAccounts", params: ["program", { dataSlice: { offset: 0, length: 0 } }] };
const response = (result: unknown[] = [{ pubkey: "owned-account" }]) => Response.json({ jsonrpc: "2.0", id: request.id, result });
function fixture(replies: (Response | Error)[], initialTime = 0) {
  let time = initialTime;
  const calls: { url: string; body: unknown }[] = [];
  const delays: number[] = [];
  const fetchImpl = (async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    const next = replies.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, "unexpected extra request");
    return next;
  }) as typeof fetch;
  return {
    calls, delays,
    options: { fetchImpl, now: () => time, sleep: async (ms: number) => { delays.push(ms); time += ms; } },
  };
}

test("account scans retry temporary HTTP/RPC failures within a bounded read-only request", async () => {
  const f = fixture([
    new Response("busy", { status: 429, headers: { "retry-after": "2" } }),
    Response.json({ jsonrpc: "2.0", id: request.id, error: { code: -32005, message: "Node is unhealthy" } }),
    response(),
  ]);
  assert.deepEqual(await readPublicProgramAccounts(request, f.options), [{ pubkey: "owned-account" }]);
  assert.deepEqual(f.delays, [2_000, 3_000]);
  assert.equal(f.calls.length, 3);
  for (const call of f.calls) {
    assert.equal(call.url, PUBLIC_INDEX_RPC);
    assert.deepEqual(call.body, request);
  }
});

test("network failures and 503 responses recover without an empty-account fallback", async () => {
  const f = fixture([new TypeError("network unavailable"), new Response(null, { status: 503 }), response()]);
  assert.equal((await readPublicProgramAccounts(request, f.options)).length, 1);
  assert.equal(f.calls.length, 3);
});

test("persistent failures stop after three attempts and expose only safe diagnostics", async () => {
  const f = fixture(Array.from({ length: 3 }, () => new Response("private provider body", { status: 503 })));
  await assert.rejects(readPublicProgramAccounts(request, f.options), (error: unknown) => {
    assert.ok(error instanceof PublicAccountReadError);
    assert.equal(error.attempts, 3);
    assert.equal(error.status, 503);
    assert.equal(error.message.includes("private"), false);
    return true;
  });
  assert.equal(f.calls.length, 3);
});

test("authorization, unsupported methods and invalid parameters are not retried", async () => {
  for (const reply of [
    new Response(null, { status: 403 }),
    new Response(null, { status: 401 }),
    Response.json({ error: { code: -32602, message: "Indexed requests require a token; rate limit" } }),
    Response.json({ error: { code: -32601, message: "Method not found" } }),
  ]) {
    const f = fixture([reply]);
    await assert.rejects(readPublicProgramAccounts(request, f.options), PublicAccountReadError);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.delays, []);
  }
});

test("retry-after beyond the request budget stops immediately rather than hammering the provider", async () => {
  for (const retryAfter of ["30", new Date(30_000).toUTCString()]) {
    const f = fixture([new Response(null, { status: 429, headers: { "retry-after": retryAfter } })]);
    await assert.rejects(readPublicProgramAccounts(request, { ...f.options, deadline: 25_000 }), (error: unknown) => {
      assert.ok(error instanceof PublicAccountReadError);
      assert.equal(error.retryAfterSeconds, 30);
      return true;
    });
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.delays, []);
  }
});

test("verification time counts toward the route deadline", async () => {
  const expired = fixture([], 24_800);
  await assert.rejects(readPublicProgramAccounts(request, { ...expired.options, deadline: 25_000 }), PublicAccountReadError);
  assert.equal(expired.calls.length, 0);
  const late = fixture([new Response(null, { status: 503 })], 24_000);
  await assert.rejects(readPublicProgramAccounts(request, { ...late.options, deadline: 25_000 }), PublicAccountReadError);
  assert.equal(late.calls.length, 1);
  assert.deepEqual(late.delays, []);
});

test("sequential recovery checks always read fresh accounts, including newly created owned accounts", async () => {
  const f = fixture([response(), response([{ pubkey: "owned-account" }, { pubkey: "new-account" }])]);
  assert.equal((await readPublicProgramAccounts(request, f.options)).length, 1);
  assert.equal((await readPublicProgramAccounts(request, f.options)).length, 2);
  assert.equal(f.calls.length, 2);
});

test("malformed and mismatched RPC responses fail closed, even if the result looks empty", async () => {
  for (const reply of [
    { jsonrpc: "2.0", id: "different-read", result: [] },
    { id: request.id, result: [] },
    { jsonrpc: "2.0", id: request.id, result: null },
    { jsonrpc: "2.0", id: request.id, error: { code: -32602 }, result: [] },
  ]) {
    const f = fixture([Response.json(reply)]);
    await assert.rejects(readPublicProgramAccounts(request, f.options), PublicAccountReadError);
    assert.equal(f.calls.length, 1);
  }
});

test("the retry helper cannot broadcast or execute other RPC methods", async () => {
  const f = fixture([]);
  await assert.rejects(readPublicProgramAccounts({ ...request, method: "sendTransaction" }, f.options), /Only getProgramAccounts/);
  assert.equal(f.calls.length, 0);
});
