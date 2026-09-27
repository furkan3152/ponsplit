// Local playground: deploys everything (with mock WETH + Uniswap V2 factory) to a running
// `npx hardhat node`, then launches a few tokens with trades so the web app has data.
//
//   npx hardhat node                                   # terminal 1
//   npx hardhat run scripts/local-demo.js --network localhost   # terminal 2
//
// The claim signer is Hardhat account #1; put its well-known private key in web/.env.local as
// SIGNER_PRIVATE_KEY when running the web app against this node.
const { ethers } = require("hardhat");

const CURVE = {
  virtualEth: ethers.parseEther("1.5"),
  virtualToken: ethers.parseEther("1073000000"),
  curveSupply: ethers.parseEther("793100000"),
  lpSupply: ethers.parseEther("206900000"),
};

async function main() {
  const [owner, signer, alice, bob, carol] = await ethers.getSigners();

  const vault = await ethers.deployContract("FeeVault", [owner.address, signer.address]);
  const launchpad = await ethers.deployContract("SplitLaunchpad", [owner.address, await vault.getAddress(), CURVE]);
  await vault.setLaunchpad(await launchpad.getAddress());
  const weth = await ethers.deployContract("MockWETH");
  const factory = await ethers.deployContract("MockFactory");
  await launchpad.setDex(await factory.getAddress(), await weth.getAddress());

  const launches = [
    ["Pon Coin", "PON", "The original split coin.", ["ponsplit", "alice_dev"], [7000, 3000], "0.2"],
    ["Robin Frog", "RFROG", "Green frog, green candles.", ["frogmaxi", "hoodlum", "gm_eth"], [4000, 3000, 3000], "0.05"],
    ["Split Cat", "SCAT", "Cats share. Sometimes.", ["catdao"], [10000], "0"],
  ];

  const tokens = [];
  for (const [name, symbol, desc, handles, bps, devBuy] of launches) {
    const tx = await launchpad
      .connect(alice)
      .createToken(name, symbol, "", desc, handles, bps, 0, { value: ethers.parseEther(devBuy) });
    const receipt = await tx.wait();
    const ev = receipt.logs.map((l) => launchpad.interface.parseLog(l)).find((l) => l?.name === "TokenCreated");
    tokens.push(ev.args.token);
    console.log(`${symbol}: ${ev.args.token}`);
  }

  await launchpad.connect(bob).buy(tokens[0], 0, { value: ethers.parseEther("1.3") });
  await launchpad.connect(carol).buy(tokens[1], 0, { value: ethers.parseEther("0.4") });
  // Push SCAT through the whole curve and migrate it.
  await launchpad.connect(carol).buy(tokens[2], 0, { value: ethers.parseEther("6") });
  await launchpad.migrate(tokens[2]);

  console.log("\nweb/.env.local:");
  console.log("NEXT_PUBLIC_CHAIN=local");
  console.log(`NEXT_PUBLIC_LAUNCHPAD_ADDRESS=${await launchpad.getAddress()}`);
  console.log(`NEXT_PUBLIC_FEE_VAULT_ADDRESS=${await vault.getAddress()}`);
  console.log("SIGNER_PRIVATE_KEY=<Hardhat account #1 private key, printed by `npx hardhat node`>");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
