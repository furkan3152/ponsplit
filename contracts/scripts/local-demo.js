// Local playground: deploys everything to a running `npx hardhat node`, then launches a few
// tokens with trades (one graduates to the PonSwap pool) so the web app has data.
//
//   npx hardhat node                                             # terminal 1
//   npx hardhat run scripts/local-demo.js --network localhost    # terminal 2
//
// Uses Hardhat account #1 as the attestation/claim signer and the web app's "mock" X resolver
// ids, so run the web app with X_RESOLVER=mock and SIGNER_PRIVATE_KEY = account #1's key.
const { ethers } = require("hardhat");

// Must match mockXId() in src/lib/x.ts.
const mockXId = (handle) => (BigInt(ethers.keccak256(ethers.toUtf8Bytes(`mock-x:${handle}`))) >> 200n) + 1n;

async function main() {
  const [owner, signer, alice, bob, carol, dave] = await ethers.getSigners();

  const vault = await ethers.deployContract("FeeVault", [owner.address, signer.address]);
  const launchpad = await ethers.deployContract("SplitLaunchpad", [
    owner.address,
    await vault.getAddress(),
    {
      virtualEth: ethers.parseEther("1.5"),
      virtualToken: ethers.parseEther("1073000000"),
      curveSupply: ethers.parseEther("793100000"),
      lpSupply: ethers.parseEther("206900000"),
    },
  ]);
  await vault.setLaunchpad(await launchpad.getAddress());

  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "PonSplit FeeVault", version: "2", chainId, verifyingContract: await vault.getAddress() };
  const types = {
    SplitAttestation: [
      { name: "creator", type: "address" },
      { name: "xIds", type: "uint64[]" },
      { name: "handles", type: "string[]" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const launches = [
    ["Pon Coin", "PON", { description: "The original split coin. Two devs, one bag." }, ["ponsplit", "alice_dev"], [7000, 3000], "0.2"],
    ["Robin Frog", "RFROG", { description: "Green frog, green candles.", website: "https://example.com" }, ["frogmaxi", "hoodlum", "gm_eth"], [4000, 3000, 3000], "0.05"],
    ["Split Cat", "SCAT", { description: "Cats share. Sometimes." }, ["catdao"], [10000], "0"],
    ["Moon Pie", "MPIE", { description: "Half for me, half for you." }, ["piechef", "moonboi"], [5000, 5000], "0.02"],
  ];

  const tokens = [];
  for (const [name, symbol, meta, handles, bps, devBuy] of launches) {
    const xIds = handles.map(mockXId);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const attestation = await signer.signTypedData(domain, types, { creator: alice.address, xIds, handles, deadline });
    const tx = await launchpad
      .connect(alice)
      .createToken(name, symbol, JSON.stringify(meta), { xIds, handles, bps, deadline, attestation }, 0, {
        value: ethers.parseEther(devBuy),
      });
    const receipt = await tx.wait();
    const ev = receipt.logs.map((l) => launchpad.interface.parseLog(l)).find((l) => l?.name === "TokenCreated");
    tokens.push(ev.args.token);
    console.log(`${symbol}: ${ev.args.token}`);
  }

  // Some price action: alternating buys and sells so charts have candles.
  const traders = [bob, carol, dave];
  for (let i = 0; i < 24; i++) {
    const who = traders[i % 3];
    const t = tokens[i % 2 === 0 ? 0 : 1];
    if (i % 4 === 3) {
      const token = await ethers.getContractAt("SplitToken", t);
      const bal = await token.balanceOf(who.address);
      if (bal > 0n) await launchpad.connect(who).sell(t, bal / 3n, 0);
    } else {
      await launchpad.connect(who).buy(t, 0, { value: ethers.parseEther((0.05 + (i % 5) * 0.04).toFixed(2)) });
    }
    await ethers.provider.send("evm_increaseTime", [90]);
    await ethers.provider.send("evm_mine", []);
  }
  // SCAT sells out its curve and keeps trading in the pool.
  await launchpad.connect(carol).buy(tokens[2], 0, { value: ethers.parseEther("6") });
  await launchpad.connect(dave).buy(tokens[2], 0, { value: ethers.parseEther("0.5") });

  console.log("\n.env.local (repo root):");
  console.log("NEXT_PUBLIC_CHAIN=local");
  console.log(`NEXT_PUBLIC_LAUNCHPAD_ADDRESS=${await launchpad.getAddress()}`);
  console.log(`NEXT_PUBLIC_FEE_VAULT_ADDRESS=${await vault.getAddress()}`);
  console.log("X_RESOLVER=mock");
  console.log("SIGNER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d  # Hardhat #1");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
