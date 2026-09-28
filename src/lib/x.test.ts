import assert from "node:assert/strict";
import { test } from "node:test";

process.env.X_RESOLVER = "fxtwitter";
const upstream: string[] = [];
// Usernames starting with "r" exist; anything else is a 404. api.x.com answers 429 when xApiLimited.
// "rflaky…" accounts exist but the mirror's first endpoint wrongly answers 404 for them.
let xApiLimited = false;
globalThis.fetch = (async (url: string | URL) => {
  const u = String(url);
  upstream.push(u);
  if (u.startsWith("https://api.x.com/")) {
    if (xApiLimited) return new Response("{}", { status: 429 });
    const names = new URL(u).searchParams.get("usernames")!.split(",");
    return Response.json({ data: names.filter((n) => n.startsWith("r")).map((n) => ({ id: String(n.length + 1000), username: n, name: n })) });
  }
  const h = u.split("/").pop()!;
  if (!h.startsWith("r")) return new Response("{}", { status: 404 });
  if (h.startsWith("rflaky") && !u.includes("/2/profile/")) return new Response('{"code":404,"message":"User not found"}', { status: 404 });
  return Response.json({ user: { id: String(h.length + 2000), screen_name: h, name: h } });
}) as typeof fetch;

const { ResolverBusyError, resolveHandles } = await import("./x.ts");
const names = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test("an IPv4 client gets its full preview budget (20 a minute), not half", async () => {
  const a = await resolveHandles(names("ra", 10), "display", "9.9.9.1");
  const b = await resolveHandles(names("rb", 10), "display", "9.9.9.1");
  assert.equal(Object.keys(a).length, 10);
  assert.equal(Object.keys(b).length, 10);
  // Over budget with nothing cached: a clear "busy" rather than an empty answer.
  await assert.rejects(resolveHandles(["rc0"], "display", "9.9.9.1"), ResolverBusyError);
  // Cached answers still come back, with the rest left out.
  const c = await resolveHandles(["ra0", "rc1"], "display", "9.9.9.1");
  assert.deepEqual(Object.keys(c), ["ra0"]);
});

test("IPv6 /64s of one /48 share a network preview budget", async () => {
  let got = 0;
  for (let sub = 0; sub < 10; sub++) {
    const r = await resolveHandles(names(`rd${sub}x`, 10), "display", `2001:db8:5:${sub}::/64`).catch(() => ({}));
    got += Object.keys(r).length;
  }
  assert.equal(got, 60);
});

test("past the global preview cap every new client still gets a fair share", async () => {
  // Use up the global cap from many clients.
  for (let i = 0; i < 20; i++) await resolveHandles(names(`re${i}x`, 10), "display", `8.8.${i}.1`).catch(() => ({}));
  const r = await resolveHandles(names("rf", 10), "display", "7.7.7.7");
  assert.equal(Object.keys(r).length, 4);
});

test("launches have no global cap: many clients can't lock out the next launch", async () => {
  for (let i = 0; i < 60; i++) await resolveHandles(names(`rg${i}x`, 10), "attest", `6.6.${i}.1`);
  const r = await resolveHandles(["rh0", "rh1"], "attest", "5.5.5.5");
  assert.equal(Object.keys(r).length, 2);
});

test("a launch over its client's budget is refused whole", async () => {
  await resolveHandles(names("ri", 10), "attest", "4.4.4.4");
  await resolveHandles(names("rj", 10), "attest", "4.4.4.4");
  await assert.rejects(resolveHandles(names("rk", 11), "attest", "4.4.4.4"), ResolverBusyError);
  assert.equal(Object.keys(await resolveHandles(names("rl", 10), "attest", "4.4.4.4")).length, 10);
});

test("x-api mode: past the X API cap, or when X rate-limits us, launches use fxtwitter", async () => {
  process.env.X_RESOLVER = "x-api";
  try {
    upstream.length = 0;
    for (let i = 0; i < 70; i++) await resolveHandles([`rm${i}`], "attest", `3.3.${i}.1`);
    const xCalls = upstream.filter((u) => u.startsWith("https://api.x.com/")).length;
    assert.equal(xCalls, 60);
    assert.equal(upstream.length, 70);
    xApiLimited = true;
    const r = await resolveHandles(["rn0"], "attest", "2.2.2.2");
    assert.equal(r.rn0?.id, String("rn0".length + 2000));
  } finally {
    process.env.X_RESOLVER = "fxtwitter";
    xApiLimited = false;
  }
});

test("a mirror 404 is confirmed before an account counts as missing", async () => {
  upstream.length = 0;
  const r = await resolveHandles(["rflaky1", "nobody1"], "display", "1.1.1.1");
  assert.equal(r.rflaky1?.id, String("rflaky1".length + 2000));
  assert.equal(r.nobody1, null);
  // Each 404 was checked a second time through the other endpoint.
  assert.equal(upstream.filter((u) => u.includes("/2/profile/")).length, 2);
});

test("a launch looks a remembered miss up again", async () => {
  await resolveHandles(["nobody2"], "display", "1.1.1.2");
  upstream.length = 0;
  const r = await resolveHandles(["nobody2"], "attest", "1.1.1.2");
  assert.equal(r.nobody2, null);
  assert.ok(upstream.length > 0);
  // Previews still use the remembered answer.
  upstream.length = 0;
  await resolveHandles(["nobody2"], "display", "1.1.1.2");
  assert.equal(upstream.length, 0);
});

test("concurrent lookups of the same account share one upstream request", async () => {
  upstream.length = 0;
  await Promise.all([1, 2, 3, 4].map((i) => resolveHandles(["rshared"], "display", `1.1.2.${i}`)));
  assert.equal(upstream.filter((u) => u.endsWith("/rshared")).length, 1);
});
