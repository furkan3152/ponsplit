// Deep, randomized lifecycle test against a live chain in one eth_call (nothing sent or spent):
// many trader accounts, several coins (incl. a 10-way split and an X account shared by two
// coins), a random buy/sell storm with solvency checks after every step, graduation, pool
// trading, rejected attacks (bad signatures, replays, redirects, slippage, overselling), and
// every X account claiming. Deterministic per SEED.
//
//   RPC_URL=https://rpc.testnet.chain.robinhood.com STEPS=60 TRADERS=12 node scripts/deep-simulate.js
const { ethers } = require("ethers");
const artifact = require("../artifacts/contracts/test/DeepSimulator.sol/DeepSimulator.json");

const RESULT =
  "tuple(uint256 traders,uint256 tokens,uint256 trades,uint256 buys,uint256 sells,uint256 graduated,uint256 invariantChecks,uint256 creatorFees,uint256 claimed,uint256 claims,uint256 rejectedAttacks,uint256 protocolFees,bool ok,string failure)";

async function main() {
  const url = process.env.RPC_URL || "http://127.0.0.1:8545";
  const steps = Number(process.env.STEPS || 60);
  const traderCount = Number(process.env.TRADERS || 12);
  const seed = BigInt(process.env.SEED || Math.floor(Math.random() * 1e9));
  const gas = Number(process.env.GAS || 120_000_000);

  const provider = new ethers.JsonRpcProvider(url);
  const { chainId } = await provider.getNetwork();
  const block = await provider.getBlock("latest");

  const caller = ethers.Wallet.createRandom().address;
  const signer = ethers.Wallet.createRandom();
  const forger = ethers.Wallet.createRandom();
  const sim = ethers.getCreateAddress({ from: caller, nonce: 0 });
  const vault = ethers.getCreateAddress({ from: sim, nonce: 1 });
  const traders = Array.from({ length: traderCount }, (_, i) => ethers.getCreateAddress({ from: sim, nonce: 3 + i }));
  const deadline = BigInt(block.timestamp + 3600);
  const domain = { name: "PonSplit FeeVault", version: "2", chainId, verifyingContract: vault };

  const plans = [
    { handles: ["alpha", "beta"], xIds: [101n, 102n], bps: [6000, 4000] },
    { handles: Array.from({ length: 10 }, (_, i) => `acct${i + 1}`), xIds: Array.from({ length: 10 }, (_, i) => BigInt(201 + i)), bps: Array(10).fill(1000) },
    { handles: ["beta"], xIds: [102n], bps: [10000] }, // same X account as coin 0
  ];
  const attType = { SplitAttestation: [{ name: "creator", type: "address" }, { name: "xIds", type: "uint64[]" }, { name: "handles", type: "string[]" }, { name: "deadline", type: "uint256" }] };
  for (const p of plans) {
    p.attestation = await signer.signTypedData(domain, attType, { creator: sim, xIds: p.xIds, handles: p.handles, deadline });
  }

  const claimType = { Claim: [{ name: "xId", type: "uint64" }, { name: "to", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
  const ids = [...new Set(plans.flatMap((p) => p.xIds.map(String)))].map(BigInt);
  const claims = [];
  for (const [i, xId] of ids.entries()) {
    const to = traders[i % traders.length];
    claims.push({ xId, to, sig: await signer.signTypedData(domain, claimType, { xId, to, nonce: 0n, deadline }) });
  }
  const forgedSig = await forger.signTypedData(domain, claimType, { xId: ids[0], to: claims[0].to, nonce: 0n, deadline });

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
  const tx = await factory.getDeployTransaction(signer.address, seed, steps, traderCount, deadline, plans, deadline, claims, forgedSig);
  const value = ethers.parseEther("0.015") + ethers.parseEther("3") * BigInt(traderCount) + ethers.parseEther("14");
  const call = { from: caller, data: tx.data, value: ethers.toQuantity(value), gas: ethers.toQuantity(gas) };
  const overrides = { [caller]: { balance: ethers.toQuantity(value + ethers.parseEther("10")) } };

  console.log(`chain ${chainId} @ block ${block.number} · seed ${seed} · ${traderCount} traders · ${steps} random steps`);
  const t0 = Date.now();
  const raw = await provider.send("eth_call", [call, "latest", overrides]);
  const [r] = ethers.AbiCoder.defaultAbiCoder().decode([RESULT], raw);
  const f = (x) => ethers.formatEther(x);
  console.log(`coins ${r.tokens}, traders ${r.traders}, trades ${r.trades} (${r.buys} buys / ${r.sells} sells), graduated ${r.graduated}`);
  console.log(`invariant checks ${r.invariantChecks}, attacks rejected ${r.rejectedAttacks}/6`);
  console.log(`fees split ${f(r.creatorFees)} ETH, claimed ${f(r.claimed)} ETH by ${r.claims} X accounts, protocol ${f(r.protocolFees)} ETH`);
  console.log(`eth_call took ${Date.now() - t0} ms`);
  if (!r.ok || r.rejectedAttacks !== 6n) throw new Error(`DEEP SIMULATION FAILED: ${r.failure || "attack not rejected"}`);
  console.log("DEEP SIMULATION PASSED");
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
