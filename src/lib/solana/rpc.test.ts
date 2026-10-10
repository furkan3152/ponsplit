import test from "node:test";
import assert from "node:assert/strict";
import { publicRpcEndpoint, PUBLIC_MAINNET_RPC } from "./rpc.ts";

test("public mainnet is the default and local validators require exact loopback hosts", () => {
  assert.equal(publicRpcEndpoint(), PUBLIC_MAINNET_RPC);
  assert.equal(publicRpcEndpoint(" "), PUBLIC_MAINNET_RPC);
  assert.equal(publicRpcEndpoint("http://127.0.0.1:8899"), "http://127.0.0.1:8899/");
  assert.equal(publicRpcEndpoint("http://localhost:8899"), "http://localhost:8899/");
  for (const value of ["https://localhost.example", "http://127.0.0.1.example", "https://rpc.example/key", "file://localhost/", "http://user:secret@localhost:8899", "http://localhost:8899?key=secret"]) {
    assert.throws(() => publicRpcEndpoint(value));
  }
});
