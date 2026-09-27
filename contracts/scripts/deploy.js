// Deploys FeeVault + SplitLaunchpad and wires them together.
//
//   DEPLOYER_PRIVATE_KEY=0x... CLAIM_SIGNER_ADDRESS=0x... npx hardhat run scripts/deploy.js --network robinhoodTestnet
//
// Optional env:
//   OWNER_ADDRESS          owner of both contracts (defaults to the deployer)
//   DEX_FACTORY, WETH      Uniswap V2 compatible factory + WETH on the target chain; can be set later with setDex
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const CURVE = {
  virtualEth: ethers.parseEther(process.env.CURVE_VIRTUAL_ETH || "1.5"),
  virtualToken: ethers.parseEther("1073000000"),
  curveSupply: ethers.parseEther("793100000"),
  lpSupply: ethers.parseEther("206900000"),
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const owner = process.env.OWNER_ADDRESS || deployer.address;
  const claimSigner = process.env.CLAIM_SIGNER_ADDRESS;
  if (!claimSigner) throw new Error("CLAIM_SIGNER_ADDRESS is required (address of the web app's SIGNER_PRIVATE_KEY)");

  console.log(`Deploying to ${network.name} from ${deployer.address}`);

  const vault = await ethers.deployContract("FeeVault", [deployer.address, claimSigner]);
  await vault.waitForDeployment();
  const launchpad = await ethers.deployContract("SplitLaunchpad", [deployer.address, await vault.getAddress(), CURVE]);
  const deployTx = launchpad.deploymentTransaction();
  await launchpad.waitForDeployment();

  await (await vault.setLaunchpad(await launchpad.getAddress())).wait();

  if (process.env.DEX_FACTORY && process.env.WETH) {
    await (await launchpad.setDex(process.env.DEX_FACTORY, process.env.WETH)).wait();
    console.log(`DEX set: factory ${process.env.DEX_FACTORY}, WETH ${process.env.WETH}`);
  } else {
    console.log("DEX not set: graduated tokens cannot migrate until the owner calls setDex(factory, weth).");
  }

  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await vault.transferOwnership(owner)).wait();
    await (await launchpad.transferOwnership(owner)).wait();
  }

  const receipt = await deployTx.wait();
  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    launchpad: await launchpad.getAddress(),
    feeVault: await vault.getAddress(),
    startBlock: receipt.blockNumber,
    owner,
    claimSigner,
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2) + "\n");

  console.log(JSON.stringify(out, null, 2));
  console.log("\nAdd these to web/.env.local:");
  console.log(`NEXT_PUBLIC_LAUNCHPAD_ADDRESS=${out.launchpad}`);
  console.log(`NEXT_PUBLIC_FEE_VAULT_ADDRESS=${out.feeVault}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
