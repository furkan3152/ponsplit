import assert from "node:assert/strict";
import { test } from "node:test";

process.env.X_RESOLVER = "fxtwitter";
const fetched: string[] = [];
// Status ids ending in 7 are replies by @someone; everything else is a 404.
globalThis.fetch = (async (url: string | URL) => {
  const u = String(url);
  fetched.push(u);
  if (!u.endsWith("7")) return new Response("{}", { status: 404 });
  return Response.json({ tweet: { text: "hi", author: { id: "42", screen_name: "someone" }, replying_to: "other" } });
}) as typeof fetch;

const { ProofBusyError, verifyProofPost } = await import("./xproof.ts");
const wallet = "0x000000000000000000000000000000000000dEaD";
const post = (id: string | number) => `https://x.com/someone/status/${id}`;

test("re-checking the same post costs no upstream request", async () => {
  fetched.length = 0;
  for (let i = 0; i < 30; i++) await assert.rejects(verifyProofPost(post(1000001), wallet, "9.9.9.9"), /not found/);
  await Promise.all(Array.from({ length: 5 }, () => assert.rejects(verifyProofPost(post(1000002), wallet, "9.9.9.9"), /not found/)));
  assert.equal(fetched.length, 2);
});

test("fetches are budgeted per client, so one client can't block another's claim", async () => {
  let busy = 0;
  for (let i = 0; i < 20; i++) {
    await verifyProofPost(post(2000000 + i * 10), wallet, "8.8.8.8").catch((e) => {
      if (e instanceof ProofBusyError) busy++;
    });
  }
  assert.equal(busy, 10);
  await assert.rejects(verifyProofPost(post(3000007), wallet, "7.7.7.7"), /is a reply/);
});
