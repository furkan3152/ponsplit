const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const E = ethers.parseEther;
const handleHash = (h) => ethers.keccak256(ethers.toUtf8Bytes(h.replace(/^@/, "").toLowerCase()));

const CONFIG = {
  virtualEth: E("1.5"),
  virtualToken: E("1073000000"),
  curveSupply: E("793100000"),
  lpSupply: E("206900000"),
};

async function deploy() {
  const [owner, signer, alice, bob, carol] = await ethers.getSigners();

  const vault = await ethers.deployContract("FeeVault", [owner.address, signer.address]);
  const launchpad = await ethers.deployContract("SplitLaunchpad", [owner.address, await vault.getAddress(), CONFIG]);
  await vault.setLaunchpad(await launchpad.getAddress());

  const weth = await ethers.deployContract("MockWETH");
  const factory = await ethers.deployContract("MockFactory");

  return { owner, signer, alice, bob, carol, vault, launchpad, weth, factory };
}

async function createToken(launchpad, from, { handles = ["alice", "bob"], bps = [6000, 4000], value = 0n } = {}) {
  const tx = await launchpad
    .connect(from)
    .createToken("Pon Coin", "PON", "https://img/pon.png", "gm", handles.map(handleHash), bps, 0, { value });
  const receipt = await tx.wait();
  const log = receipt.logs.map((l) => launchpad.interface.parseLog(l)).find((l) => l?.name === "TokenCreated");
  return ethers.getContractAt("SplitToken", log.args.token);
}

async function signClaim(vault, signer, handle, to, deadline) {
  const { chainId } = await ethers.provider.getNetwork();
  const h = handleHash(handle);
  const nonce = await vault.nonces(h);
  const domain = { name: "PonSplit FeeVault", version: "1", chainId, verifyingContract: await vault.getAddress() };
  const types = {
    Claim: [
      { name: "handleHash", type: "bytes32" },
      { name: "to", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  return signer.signTypedData(domain, types, { handleHash: h, to, nonce, deadline });
}

async function graduate(launchpad, token, buyer) {
  await launchpad.connect(buyer).buy(await token.getAddress(), 0, { value: E("10") });
}

describe("SplitLaunchpad", () => {
  describe("createToken", () => {
    it("mints supply to the launchpad and stores the split", async () => {
      const { launchpad, vault, alice } = await loadFixture(deploy);
      const token = await createToken(launchpad, alice);
      const addr = await token.getAddress();

      expect(await token.totalSupply()).to.equal(CONFIG.curveSupply + CONFIG.lpSupply);
      expect(await token.balanceOf(await launchpad.getAddress())).to.equal(CONFIG.curveSupply + CONFIG.lpSupply);
      expect(await launchpad.tokenCount()).to.equal(1);

      const split = await vault.getSplit(addr);
      expect(split.map((r) => r.handleHash)).to.deep.equal([handleHash("alice"), handleHash("bob")]);
      expect(split.map((r) => r.bps)).to.deep.equal([6000n, 4000n]);

      const view = await launchpad.getToken(addr);
      expect(view.name).to.equal("Pon Coin");
      expect(view.curve.creator).to.equal(alice.address);
    });

    it("uses extra ETH as the creator's first buy", async () => {
      const { launchpad, alice } = await loadFixture(deploy);
      const token = await createToken(launchpad, alice, { value: E("0.1") });
      expect(await token.balanceOf(alice.address)).to.be.gt(0);
    });

    it("rejects invalid splits", async () => {
      const { launchpad, vault, alice } = await loadFixture(deploy);
      const bad = [
        [["alice"], [9999]],
        [["alice", "alice"], [5000, 5000]],
        [[], []],
        [["a", "b"], [10000, 0]],
        [Array.from({ length: 11 }, (_, i) => `u${i}`), Array(10).fill(1000).concat([0])],
      ];
      for (const [handles, bps] of bad) {
        await expect(
          launchpad.connect(alice).createToken("A", "A", "", "", handles.map(handleHash), bps, 0)
        ).to.be.revertedWithCustomError(vault, "InvalidSplit");
      }
    });

    it("validates metadata and the creation fee", async () => {
      const { launchpad, owner, alice } = await loadFixture(deploy);
      const hs = [handleHash("alice")];
      await expect(launchpad.createToken("", "A", "", "", hs, [10000], 0)).to.be.revertedWithCustomError(
        launchpad,
        "InvalidMetadata"
      );
      await expect(launchpad.createToken("A", "TOOLONGSYMBOL", "", "", hs, [10000], 0)).to.be.revertedWithCustomError(
        launchpad,
        "InvalidMetadata"
      );

      await launchpad.connect(owner).setFees(100, 2000, 0, E("0.01"));
      await expect(
        launchpad.connect(alice).createToken("A", "A", "", "", hs, [10000], 0, { value: E("0.005") })
      ).to.be.revertedWithCustomError(launchpad, "InsufficientPayment");
      await launchpad.connect(alice).createToken("A", "A", "", "", hs, [10000], 0, { value: E("0.01") });
      expect(await launchpad.protocolFees()).to.equal(E("0.01"));
    });
  });

  describe("trading", () => {
    it("buys along the curve and splits the fee", async () => {
      const { launchpad, vault, alice, bob } = await loadFixture(deploy);
      const token = await createToken(launchpad, alice);
      const addr = await token.getAddress();

      const [quoted, fee] = await launchpad.quoteBuy(addr, E("1"));
      await expect(launchpad.connect(bob).buy(addr, quoted, { value: E("1") })).to.emit(launchpad, "Trade");
      expect(await token.balanceOf(bob.address)).to.equal(quoted);

      expect(fee).to.equal(E("0.01"));
      const protocolCut = (fee * 2000n) / 10000n;
      expect(await launchpad.protocolFees()).to.equal(protocolCut);
      const creatorCut = fee - protocolCut;
      expect(await vault.claimable(handleHash("alice"))).to.equal((creatorCut * 6000n) / 10000n);
      expect(await vault.claimable(handleHash("bob"))).to.equal(creatorCut - (creatorCut * 6000n) / 10000n);
      expect(await vault.tokenFees(addr)).to.equal(creatorCut);
    });

    it("reverts when slippage is exceeded", async () => {
      const { launchpad, alice, bob } = await loadFixture(deploy);
      const token = await createToken(launchpad, alice);
      const addr = await token.getAddress();
      const [quoted] = await launchpad.quoteBuy(addr, E("1"));
      await expect(launchpad.connect(bob).buy(addr, quoted + 1n, { value: E("1") })).to.be.revertedWithCustomError(
        launchpad,
        "Slippage"
      );
    });

    it("sells back without an approval and never pays out more than it holds", async () => {
      const { launchpad, alice, bob } = await loadFixture(deploy);
      const token = await createToken(launchpad, alice);
      const addr = await token.getAddress();

      await launchpad.connect(bob).buy(addr, 0, { value: E("1") });
      const bal = await token.balanceOf(bob.address);
      const [ethOut] = await launchpad.quoteSell(addr, bal);

      const before = await ethers.provider.getBalance(bob.address);
      const receipt = await (await launchpad.connect(bob).sell(addr, bal, ethOut)).wait();
      const gas = receipt.gasUsed * receipt.gasPrice;
      expect(await ethers.provider.getBalance(bob.address)).to.equal(before + ethOut - gas);
      expect(await token.balanceOf(bob.address)).to.equal(0);

      // Round trip loses roughly two fees, and the curve is back at its start.
      expect(ethOut).to.be.lt(E("0.99"));
      expect(ethOut).to.be.gt(E("0.97"));
      const curve = await launchpad.curves(addr);
      expect(curve.realToken).to.equal(CONFIG.curveSupply);
      expect(curve.virtualEth).to.be.gte(CONFIG.virtualEth);
    });

    it("keeps the launchpad solvent across many trades", async () => {
      const { launchpad, alice, bob, carol } = await loadFixture(deploy);
      const token = await createToken(launchpad, alice);
      const addr = await token.getAddress();

      for (const v of ["0.3", "0.07", "1.2", "0.0001", "0.5"]) {
        await launchpad.connect(bob).buy(addr, 0, { value: E(v) });
        await launchpad.connect(carol).buy(addr, 0, { value: E(v) });
      }
      for (const who of [bob, carol]) {
        const bal = await token.balanceOf(who.address);
        await launchpad.connect(who).sell(addr, bal / 3n, 0);
        await launchpad.connect(who).sell(addr, await token.balanceOf(who.address), 0);
      }
      const curve = await launchpad.curves(addr);
      const held = await ethers.provider.getBalance(await launchpad.getAddress());
      expect(held).to.equal(curve.realEth + (await launchpad.protocolFees()));
      expect(curve.realToken).to.equal(CONFIG.curveSupply);
    });

    it("locks wallet-to-wallet transfers until migration", async () => {
      const { launchpad, alice, bob, carol } = await loadFixture(deploy);
      const token = await createToken(launchpad, alice);
      await launchpad.connect(bob).buy(await token.getAddress(), 0, { value: E("0.1") });
      await expect(token.connect(bob).transfer(carol.address, 1)).to.be.revertedWithCustomError(
        token,
        "TransfersLocked"
      );
      await expect(token.connect(bob).openTrading()).to.be.revertedWithCustomError(token, "OnlyLaunchpad");
    });
  });

  describe("graduation and migration", () => {
    it("caps the final buy, refunds the excess and graduates", async () => {
      const { launchpad, alice, bob } = await loadFixture(deploy);
      const token = await createToken(launchpad, alice);
      const addr = await token.getAddress();

      const [out, fee, refund] = await launchpad.quoteBuy(addr, E("10"));
      expect(out).to.equal(CONFIG.curveSupply);
      expect(refund).to.be.gt(0);

      const before = await ethers.provider.getBalance(bob.address);
      const receipt = await (await launchpad.connect(bob).buy(addr, 0, { value: E("10") })).wait();
      const gas = receipt.gasUsed * receipt.gasPrice;
      expect(await ethers.provider.getBalance(bob.address)).to.equal(before - E("10") + refund - gas);
      await expect(receipt).to.emit(launchpad, "Graduated");

      const curve = await launchpad.curves(addr);
      expect(curve.graduated).to.equal(true);
      expect(curve.realToken).to.equal(0);
      expect(curve.realEth + fee + refund).to.equal(E("10"));

      await expect(launchpad.connect(bob).buy(addr, 0, { value: E("1") })).to.be.revertedWithCustomError(
        launchpad,
        "CurveComplete"
      );
      await expect(launchpad.connect(bob).sell(addr, 1, 0)).to.be.revertedWithCustomError(launchpad, "CurveComplete");
    });

    it("migrates liquidity to the DEX, burns the LP and opens transfers", async () => {
      const { launchpad, owner, alice, bob, carol, weth, factory } = await loadFixture(deploy);
      const token = await createToken(launchpad, alice);
      const addr = await token.getAddress();
      await graduate(launchpad, token, bob);

      await expect(launchpad.migrate(addr)).to.be.revertedWithCustomError(launchpad, "DexNotSet");
      await launchpad.connect(owner).setDex(await factory.getAddress(), await weth.getAddress());
      await launchpad.connect(owner).setFees(100, 2000, 500, 0);

      const realEth = (await launchpad.curves(addr)).realEth;
      const protocolBefore = await launchpad.protocolFees();
      await expect(launchpad.connect(carol).migrate(addr)).to.emit(launchpad, "Migrated");

      const pairAddr = await factory.getPair(addr, await weth.getAddress());
      const pair = await ethers.getContractAt("MockPair", pairAddr);
      const migrationFee = (realEth * 500n) / 10000n;
      expect(await weth.balanceOf(pairAddr)).to.equal(realEth - migrationFee);
      expect(await token.balanceOf(pairAddr)).to.equal(CONFIG.lpSupply);
      expect(await pair.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(await pair.totalSupply());
      expect(await launchpad.protocolFees()).to.equal(protocolBefore + migrationFee);

      expect(await token.tradingOpen()).to.equal(true);
      await token.connect(bob).transfer(carol.address, 1);
      expect(await token.balanceOf(await launchpad.getAddress())).to.equal(0);

      await expect(launchpad.migrate(addr)).to.be.revertedWithCustomError(launchpad, "AlreadyMigrated");
    });

    it("migrates even if someone pre-created the pair and donated WETH", async () => {
      const { launchpad, owner, alice, bob, carol, weth, factory } = await loadFixture(deploy);
      const token = await createToken(launchpad, alice);
      const addr = await token.getAddress();
      await launchpad.connect(owner).setDex(await factory.getAddress(), await weth.getAddress());

      await factory.createPair(addr, await weth.getAddress());
      const pairAddr = await factory.getPair(addr, await weth.getAddress());
      await weth.connect(carol).deposit({ value: E("1") });
      await weth.connect(carol).transfer(pairAddr, E("1"));
      await (await ethers.getContractAt("MockPair", pairAddr)).sync();

      await graduate(launchpad, token, bob);
      await expect(launchpad.migrate(addr)).to.emit(launchpad, "Migrated");
    });

    it("rejects migration before graduation", async () => {
      const { launchpad, alice } = await loadFixture(deploy);
      const token = await createToken(launchpad, alice);
      await expect(launchpad.migrate(await token.getAddress())).to.be.revertedWithCustomError(
        launchpad,
        "NotGraduated"
      );
    });
  });

  describe("claims", () => {
    it("pays an X account's balance to the signed wallet", async () => {
      const { launchpad, vault, signer, alice, bob, carol } = await loadFixture(deploy);
      const token = await createToken(launchpad, alice);
      await launchpad.connect(bob).buy(await token.getAddress(), 0, { value: E("2") });

      const owed = await vault.claimable(handleHash("alice"));
      expect(owed).to.be.gt(0);
      const deadline = (await time.latest()) + 3600;
      const sig = await signClaim(vault, signer, "alice", carol.address, deadline);

      // Anyone can relay the claim; funds go to the signed destination.
      const before = await ethers.provider.getBalance(carol.address);
      await expect(vault.connect(bob).claim(handleHash("alice"), carol.address, deadline, sig))
        .to.emit(vault, "Claimed")
        .withArgs(handleHash("alice"), carol.address, owed);
      expect(await ethers.provider.getBalance(carol.address)).to.equal(before + owed);
      expect(await vault.claimable(handleHash("alice"))).to.equal(0);
      expect(await vault.totalEarned(handleHash("alice"))).to.equal(owed);

      // Signature cannot be replayed once the nonce moves.
      await launchpad.connect(bob).buy(await token.getAddress(), 0, { value: E("1") });
      await expect(
        vault.claim(handleHash("alice"), carol.address, deadline, sig)
      ).to.be.revertedWithCustomError(vault, "BadSignature");
    });

    it("rejects wrong signer, wrong destination, wrong handle and expired signatures", async () => {
      const { launchpad, vault, signer, alice, bob, carol } = await loadFixture(deploy);
      const token = await createToken(launchpad, alice);
      await launchpad.connect(bob).buy(await token.getAddress(), 0, { value: E("1") });
      const deadline = (await time.latest()) + 3600;

      const forged = await signClaim(vault, alice, "alice", alice.address, deadline);
      await expect(vault.claim(handleHash("alice"), alice.address, deadline, forged)).to.be.revertedWithCustomError(
        vault,
        "BadSignature"
      );

      const sig = await signClaim(vault, signer, "alice", carol.address, deadline);
      await expect(vault.claim(handleHash("alice"), bob.address, deadline, sig)).to.be.revertedWithCustomError(
        vault,
        "BadSignature"
      );
      await expect(vault.claim(handleHash("bob"), carol.address, deadline, sig)).to.be.revertedWithCustomError(
        vault,
        "BadSignature"
      );

      const past = (await time.latest()) - 1;
      const old = await signClaim(vault, signer, "alice", carol.address, past);
      await expect(vault.claim(handleHash("alice"), carol.address, past, old)).to.be.revertedWithCustomError(
        vault,
        "Expired"
      );
    });

    it("reverts when there is nothing to claim", async () => {
      const { vault, signer, carol } = await loadFixture(deploy);
      const deadline = (await time.latest()) + 3600;
      const sig = await signClaim(vault, signer, "nobody", carol.address, deadline);
      await expect(vault.claim(handleHash("nobody"), carol.address, deadline, sig)).to.be.revertedWithCustomError(
        vault,
        "NothingToClaim"
      );
    });
  });

  describe("admin", () => {
    it("restricts privileged functions to their owners", async () => {
      const { launchpad, vault, alice } = await loadFixture(deploy);
      await expect(launchpad.connect(alice).setFees(0, 0, 0, 0)).to.be.revertedWithCustomError(
        launchpad,
        "OwnableUnauthorizedAccount"
      );
      await expect(launchpad.connect(alice).setDex(alice.address, alice.address)).to.be.revertedWithCustomError(
        launchpad,
        "OwnableUnauthorizedAccount"
      );
      await expect(vault.connect(alice).setSigner(alice.address)).to.be.revertedWithCustomError(
        vault,
        "OwnableUnauthorizedAccount"
      );
      await expect(vault.setLaunchpad(alice.address)).to.be.revertedWithCustomError(vault, "LaunchpadAlreadySet");
      await expect(
        vault.connect(alice).setSplit(alice.address, [handleHash("x")], [10000])
      ).to.be.revertedWithCustomError(vault, "OnlyLaunchpad");
    });

    it("caps fees and withdraws protocol fees", async () => {
      const { launchpad, owner, alice, bob, carol } = await loadFixture(deploy);
      await expect(launchpad.setFees(501, 0, 0, 0)).to.be.revertedWithCustomError(launchpad, "InvalidConfig");
      await expect(launchpad.setFees(100, 10001, 0, 0)).to.be.revertedWithCustomError(launchpad, "InvalidConfig");
      await expect(launchpad.setFees(100, 0, 1001, 0)).to.be.revertedWithCustomError(launchpad, "InvalidConfig");

      const token = await createToken(launchpad, alice);
      await launchpad.connect(bob).buy(await token.getAddress(), 0, { value: E("1") });
      const fees = await launchpad.protocolFees();
      const before = await ethers.provider.getBalance(carol.address);
      await launchpad.connect(owner).withdrawProtocolFees(carol.address);
      expect(await ethers.provider.getBalance(carol.address)).to.equal(before + fees);
      expect(await launchpad.protocolFees()).to.equal(0);
    });

    it("pages tokens newest first", async () => {
      const { launchpad, alice } = await loadFixture(deploy);
      const hs = [handleHash("alice")];
      for (const s of ["A", "B", "C"]) await launchpad.connect(alice).createToken(s, s, "", "", hs, [10000], 0);
      const page = await launchpad.getTokens(0, 2);
      expect(page.map((t) => t.symbol)).to.deep.equal(["C", "B"]);
      expect((await launchpad.getTokens(2, 10)).map((t) => t.symbol)).to.deep.equal(["A"]);
      expect(await launchpad.getTokens(5, 10)).to.have.length(0);
    });
  });
});
