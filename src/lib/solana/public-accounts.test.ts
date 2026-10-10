import test from "node:test";
import assert from "node:assert/strict";
import bs58 from "bs58";
import { accountScanRequest } from "./public-accounts.ts";
const scope = { treasury: "D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm", program: "3Zw2boFgPgPHoxJEhuAKSyVuWWMWcys6px7kHFxRFirW", verifier: "D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm" };
const fees = () => ({ jsonrpc: "2.0", id: "read", method: "getProgramAccounts", params: ["pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ", { commitment: "confirmed", encoding: "base64", filters: [{ memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.from([216, 74, 9, 0, 56, 140, 93, 75])) } }, { memcmp: { offset: 80, bytes: scope.treasury } }] }] });
test("public account route permits only the site's fixed fee and proof scans", () => {
  assert.equal(accountScanRequest(fees(), scope)?.verifyDeployment, false);
  const serialized = JSON.parse(JSON.stringify(fees()));
  serialized.params[1].filters.forEach((f: { memcmp: { encoding?: string } }) => { f.memcmp.encoding = "base58"; });
  assert.equal(accountScanRequest(serialized, scope)?.verifyDeployment, false);
  serialized.params[1].filters[0].memcmp.encoding = "base64";
  assert.equal(accountScanRequest(serialized, scope), null);
  const proof = { jsonrpc: "2.0", id: 1, method: "getProgramAccounts", params: [scope.program, { commitment: "confirmed", encoding: "base64", filters: [{ dataSize: 143 }, { memcmp: { offset: 0, bytes: bs58.encode(new TextEncoder().encode("TIKPROOF")) } }, { memcmp: { offset: 34, bytes: scope.verifier } }] }] };
  assert.equal(accountScanRequest(proof, scope)?.verifyDeployment, false);
  for (const change of [ { method: "sendTransaction" }, { params: ["11111111111111111111111111111111", fees().params[1]] }, { params: [fees().params[0], { commitment: "confirmed", encoding: "base64" }] }, { params: [fees().params[0], { ...fees().params[1] as object, withContext: true }] } ]) {
    assert.equal(accountScanRequest({ ...fees(), ...change }, scope), null);
  }
  assert.equal(accountScanRequest([fees()], scope), null);
});
test("unfiltered recovery scans require deployment verification and cannot target configured program", () => {
  const request = { jsonrpc: "2.0", id: 1, method: "getProgramAccounts", params: ["11111111111111111111111111111111", { commitment: "confirmed", encoding: "base64", dataSlice: { offset: 0, length: 0 } }] };
  assert.equal(accountScanRequest(request, scope)?.verifyDeployment, true);
  assert.equal(accountScanRequest({ ...request, params: [scope.program, request.params[1]] }, scope), null);
});
