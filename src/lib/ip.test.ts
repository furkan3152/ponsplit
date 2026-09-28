import assert from "node:assert/strict";
import { test } from "node:test";
import { ipKey, isPrivateIp } from "./ip.ts";

test("IPv4-mapped addresses are keyed as their IPv4 address, one key per client", () => {
  assert.equal(ipKey("::ffff:203.0.113.5"), "203.0.113.5");
  assert.equal(ipKey("::ffff:198.51.100.7"), "198.51.100.7");
  assert.equal(ipKey("::ffff:cb00:7105"), "203.0.113.5");
  assert.notEqual(ipKey("::ffff:203.0.113.5"), ipKey("::ffff:198.51.100.7"));
});

test("plain IPv4 stays as is; IPv6 is keyed by /64", () => {
  assert.equal(ipKey("203.0.113.5"), "203.0.113.5");
  assert.equal(ipKey("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
  assert.equal(ipKey("2001:db8:1:2:bbbb::9"), "2001:db8:1:2::/64");
  assert.equal(ipKey(undefined), "unknown");
});

test("private and loopback detection, including mapped forms", () => {
  for (const ip of ["10.0.0.1", "127.0.0.1", "172.16.5.4", "192.168.1.1", "169.254.1.1", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.1.2.3", "not-an-ip"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["203.0.113.5", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});
