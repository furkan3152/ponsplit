// Runs the full PonSplit lifecycle against a live chain in a single eth_call: deploy, wire,
// launch, curve buy/sell, graduation, pool buy/sell and a signed claim. Nothing is sent and
// nothing is spent; the caller's balance is supplied through an eth_call state override.
//
//   RPC_URL=https://rpc.testnet.chain.robinhood.com node scripts/simulate.js
const { ethers } = require("ethers");
const artifact = require("../artifacts/contracts/test/ChainSimulator.sol/ChainSimulator.json");

const RESULT = "tuple(address vault,address launchpad,address token,uint256 curveTokensBought,uint256 curveSellEth,bool graduated,uint256 poolEth,uint256 poolTokens,uint256 poolTokensBought,uint256 poolSellEth,uint256 creatorFees,uint256 claimed,uint256 tradeCount,bool solvent)";

async function main() {
  const url = process.env.RPC_URL || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(url);
  const { chainId } = await provider.getNetwork();
  const block = await provider.getBlock("latest");

  // Throwaway identities that exist only for this simulation.
  const caller = ethers.Wallet.createRandom().address;
  const signer = ethers.Wallet.createRandom();
  const simulator = ethers.getCreateAddress({ from: caller, nonce: 0 });
  const vault = ethers.getCreateAddress({ from: simulator, nonce: 1 });

  const xId = 12n;
  const handle = "jack";
  const deadline = BigInt(block.timestamp + 3600);
  const domain = { name: "PonSplit FeeVault", version: "2", chainId, verifyingContract: vault };
  const attestation = await signer.signTypedData(
    domain,
    { SplitAttestation: [{ name: "creator", type: "address" }, { name: "xIds", type: "uint64[]" }, { name: "handles", type: "string[]" }, { name: "deadline", type: "uint256" }] },
    { creator: simulator, xIds: [xId], handles: [handle], deadline }
  );
  const claimSig = await signer.signTypedData(
    domain,
    { Claim: [{ name: "xId", type: "uint64" }, { name: "to", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    { xId, to: simulator, nonce: 0n, deadline }
  );

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
  const tx = await factory.getDeployTransaction(signer.address, xId, handle, deadline, attestation, deadline, claimSig);
  const value = ethers.parseEther("11.51");

  const call = { from: caller, data: tx.data, value: ethers.toQuantity(value), gas: ethers.toQuantity(60_000_000) };
  const overrides = { [caller]: { balance: ethers.toQuantity(ethers.parseEther("100")) } };
  console.log(`chain ${chainId} @ block ${block.number}, simulating from ${caller}`);
  const [raw, gas] = await Promise.all([
    provider.send("eth_call", [call, "latest", overrides]),
    provider.send("eth_estimateGas", [call, "latest", overrides]).catch((e) => `n/a (${e.shortMessage || e.message})`),
  ]);
  const [r] = ethers.AbiCoder.defaultAbiCoder().decode([RESULT], raw);

  const f = (x) => ethers.formatEther(x);
  console.log(`vault ${r.vault}  launchpad ${r.launchpad}  token ${r.token}`);
  console.log(`curve: bought ${f(r.curveTokensBought)} SIM for 1 ETH, sold half for ${f(r.curveSellEth)} ETH`);
  console.log(`graduated ${r.graduated}: pool ${f(r.poolEth)} ETH / ${f(r.poolTokens)} SIM`);
  console.log(`pool: bought ${f(r.poolTokensBought)} SIM for 0.5 ETH, sold half for ${f(r.poolSellEth)} ETH`);
  console.log(`fees to X accounts ${f(r.creatorFees)} ETH, claimed ${f(r.claimed)} ETH, trades ${r.tradeCount}, solvent ${r.solvent}`);
  console.log(`gas for the whole lifecycle: ${typeof gas === "string" && gas.startsWith("0x") ? BigInt(gas) : gas}`);

  const ok = r.graduated && r.solvent && r.claimed === r.creatorFees && r.claimed > 0n && r.tradeCount === 6n && r.poolSellEth > 0n;
  if (!ok) throw new Error("SIMULATION FAILED");
  console.log("SIMULATION PASSED");
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
