import assert from "node:assert/strict";
import { test } from "node:test";
import { NETWORK_FACTOR, charge, limitClient, rateLimit, remaining } from "./ratelimit.ts";

test("limitClient: an IPv4 client gets its whole limit (client and network are the same key)", () => {
  let ok = 0;
  for (let i = 0; i < 25; i++) if (limitClient("t1", "1.2.3.4", 20)) ok++;
  assert.equal(ok, 20);
});

test("limitClient: the /64s of one IPv6 /48 share a network limit", () => {
  let ok = 0;
  for (let sub = 0; sub < 40; sub++) {
    for (let i = 0; i < 5; i++) if (limitClient("t2", `2001:db8:1:${sub.toString(16)}::/64`, 5)) ok++;
  }
  assert.equal(ok, 5 * NETWORK_FACTOR);
  // Another /48 is unaffected.
  assert.equal(limitClient("t2", "2001:db8:2:0::/64", 5), true);
});

test("limitClient: a refused request costs nothing", () => {
  for (let i = 0; i < 3; i++) limitClient("t3", "5.6.7.8", 3);
  assert.equal(limitClient("t3", "5.6.7.8", 3), false);
  assert.equal(remaining("t3:5.6.7.8", 3), 0);
  assert.equal(remaining("t3:5.6.7.8", 4), 1);
});

test("shared windows survive a flood of fresh client keys", () => {
  charge("t4:*", 7, 60_000);
  charge("t4:2001:db8:9::/48", 7, 60_000);
  for (let i = 0; i < 10_050; i++) rateLimit(`flood:10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`, 1, 60_000);
  assert.equal(remaining("t4:*", 10), 3);
  assert.equal(remaining("t4:2001:db8:9::/48", 10), 3);
});
