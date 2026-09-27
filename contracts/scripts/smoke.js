// Read-only end-to-end check against a live deployment: signs a real attestation with the signer
// key and simulates createToken (with a first buy) and the quotes via eth_call. Changes nothing.
//
//   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/smoke.js --network robinhoodTestnet
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`), "utf8"));
  const [signer] = await ethers.getSigners();
  const vault = await ethers.getContractAt("FeeVault", dep.feeVault);
  const launchpad = await ethers.getContractAt("SplitLaunchpad", dep.launchpad);

  const vaultSigner = await vault.signer();
  console.log(`vault.signer      ${vaultSigner}`);
  console.log(`vault.launchpad   ${await vault.launchpad()}`);
  console.log(`launchpad.vault   ${await launchpad.vault()}`);
  console.log(`fee / protocol    ${await launchpad.feeBps()} bps / ${await launchpad.protocolShareBps()} bps`);
  if (vaultSigner.toLowerCase() !== signer.address.toLowerCase()) throw new Error("vault signer is not this key");
  if ((await vault.launchpad()).toLowerCase() !== dep.launchpad.toLowerCase()) throw new Error("vault not wired to launchpad");

  // Resolve a real X account the same way the web app does.
  const handle = process.env.SMOKE_HANDLE || "jack";
  const xId = process.env.SMOKE_XID
    ? BigInt(process.env.SMOKE_XID)
    : BigInt((await (await fetch(`https://api.fxtwitter.com/${handle}`)).json()).user.id);
  console.log(`resolved @${handle} → ${xId}`);

  const { chainId } = await ethers.provider.getNetwork();
  const block = await ethers.provider.getBlock("latest");
  const deadline = BigInt(block.timestamp + 600);
  const attestation = await signer.signTypedData(
    { name: "PonSplit FeeVault", version: "2", chainId, verifyingContract: dep.feeVault },
    {
      SplitAttestation: [
        { name: "creator", type: "address" },
        { name: "xIds", type: "uint64[]" },
        { name: "handles", type: "string[]" },
        { name: "deadline", type: "uint256" },
      ],
    },
    { creator: signer.address, xIds: [xId], handles: [handle], deadline }
  );
  const split = { xIds: [xId], handles: [handle], bps: [10000], deadline, attestation };
  const predicted = await launchpad.createToken.staticCall("Smoke Test", "SMOKE", "{}", split, 0, { value: ethers.parseEther("0.0001") });
  console.log(`simulated createToken + first buy OK → would deploy ${predicted}`);
  console.log("SMOKE TEST PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
