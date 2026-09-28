// Readies a Hardhat fork of a Robinhood network for the tests:
//  - Hardhat's well-known accounts carry EIP-7702 delegations on the real networks (sweeper bots
//    set them) and refuse plain ETH; on the fork they become plain accounts again;
//  - Arbitrum block headers have no blob-gas fields and the node can't run calls against the fork
//    block itself, so one local block is mined before anything else reads the chain;
//  - on mainnet, a closed pons launch gate is reopened (the tests are about SplitEarn, not about
//    pons's uptime), and said so.
// Nothing here reaches the real network.
//   RPC=http://127.0.0.1:8545 NETWORK=testnet|mainnet node prepare-fork.mjs
import { ethers } from "ethers";

const RPC = process.env.RPC || "http://127.0.0.1:8545";
const PONS_MAINNET_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
let id = 0;
async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const accounts = await rpc("eth_accounts");
let cleared = 0;
for (const a of accounts.slice(0, 10)) {
  if ((await rpc("eth_getCode", [a, "latest"])) !== "0x") {
    await rpc("hardhat_setCode", [a, "0x"]);
    cleared++;
  }
}
await rpc("evm_mine");

if (process.env.NETWORK === "mainnet") {
  const pons = new ethers.Interface(["function launchEnabled() view returns (bool)", "function owner() view returns (address)", "function setLaunchEnabled(bool)"]);
  const call = async (name) => pons.decodeFunctionResult(name, await rpc("eth_call", [{ to: PONS_MAINNET_FACTORY, data: pons.encodeFunctionData(name) }, "latest"]))[0];
  if (!(await call("launchEnabled"))) {
    const owner = await call("owner");
    await rpc("hardhat_impersonateAccount", [owner]);
    await rpc("hardhat_setBalance", [owner, "0x56BC75E2D63100000"]);
    await rpc("eth_sendTransaction", [{ from: owner, to: PONS_MAINNET_FACTORY, data: pons.encodeFunctionData("setLaunchEnabled", [true]) }]);
    await rpc("hardhat_stopImpersonatingAccount", [owner]);
    console.log("pons launches are closed on mainnet right now; reopened on the fork");
  }
}
console.log(`fork ready: chain ${Number(await rpc("eth_chainId"))}, block ${Number(await rpc("eth_blockNumber"))}, delegations cleared on ${cleared} test accounts`);
