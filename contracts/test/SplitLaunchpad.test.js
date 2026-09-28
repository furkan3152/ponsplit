const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const E = ethers.parseEther;

const CONFIG = {
  virtualEth: E("1.5"),
  virtualToken: E("1073000000"),
  curveSupply: E("793100000"),
  lpSupply: E("206900000"),
};

const IDS = { alice: 1001n, bob: 2002n, carol: 3003n };

async function deploy() {
  const [owner, signer, alice, bob, carol] = await ethers.getSigners();
  const vault = await ethers.deployContract("FeeVault", [owner.address, signer.address]);
  const launchpad = await ethers.deployContract("SplitLaunchpad", [owner.address, await vault.getAddress(), CONFIG]);
  await vault.setLaunchpad(await launchpad.getAddress());
  return { owner, signer, alice, bob, carol, vault, launchpad };
}

async function domain(vault) {
  const { chainId } = await ethers.provider.getNetwork();
  return { name: "PonSplit FeeVault", version: "2", chainId, verifyingContract: await vault.getAddress() };
}

async function attest(vault, signer, creator, xIds, handles, deadline) {
  const types = {
    SplitAttestation: [
      { name: "creator", type: "address" },
      { name: "xIds", type: "uint64[]" },
      { name: "handles", type: "string[]" },
      { name: "deadline", type: "uint256" },
    ],
  };
  return signer.signTypedData(await domain(vault), types, { creator, xIds, handles, deadline });
}

async function signClaim(vault, signer, xId, to, deadline) {
  const types = {
    Claim: [
      { name: "xId", type: "uint64" },
      { name: "to", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const nonce = await vault.nonces(xId);
  return signer.signTypedData(await domain(vault), types, { xId, to, nonce, deadline });
}

async function split(vault, signer, creator, { handles = ["alice", "bob"], xIds, bps = [6000, 4000], deadline } = {}) {
  xIds = xIds ?? handles.map((h) => IDS[h] ?? BigInt(h.length) * 7919n);
  deadline = deadline ?? BigInt((await time.latest()) + 600);
  const attestation = await attest(vault, signer, creator, xIds, handles, deadline);
  return { xIds, handles, bps, deadline, attestation };
}

async function createToken(fx, from, opts = {}) {
  const { launchpad, vault, signer } = fx;
  const s = await split(vault, signer, from.address, opts);
  const tx = await launchpad
    .connect(from)
    .createToken("Pon Coin", "PON", '{"description":"gm"}', s, 0, { value: opts.value ?? 0n });
  const receipt = await tx.wait();
  const log = receipt.logs.map((l) => launchpad.interface.parseLog(l)).find((l) => l?.name === "TokenCreated");
  return ethers.getContractAt("SplitToken", log.args.token);
}

async function graduate(launchpad, token, buyer) {
  await launchpad.connect(buyer).buy(await token.getAddress(), 0, { value: E("10") });
}

async function ethDelta(who, fn) {
  const before = await ethers.provider.getBalance(who.address);
  const receipt = await (await fn()).wait();
  const after = await ethers.provider.getBalance(who.address);
  return after - before + receipt.gasUsed * receipt.gasPrice;
}

describe("SplitLaunchpad", () => {
  describe("createToken", () => {
    it("mints supply to the launchpad and stores the attested split", async () => {
      const fx = await loadFixture(deploy);
      const token = await createToken(fx, fx.alice);
      const addr = await token.getAddress();

      expect(await token.totalSupply()).to.equal(CONFIG.curveSupply + CONFIG.lpSupply);
      expect(await token.balanceOf(await fx.launchpad.getAddress())).to.equal(CONFIG.curveSupply + CONFIG.lpSupply);

      const onchain = await fx.vault.getSplit(addr);
      expect(onchain.map((r) => r.xId)).to.deep.equal([IDS.alice, IDS.bob]);
      expect(onchain.map((r) => r.bps)).to.deep.equal([6000n, 4000n]);

      const view = await fx.launchpad.getToken(addr);
      expect(view.name).to.equal("Pon Coin");
      expect(view.metadata).to.equal('{"description":"gm"}');
      expect(view.market.creator).to.equal(fx.alice.address);
      expect(view.handles).to.deep.equal(["alice", "bob"]);
      expect(view.xIds).to.deep.equal([IDS.alice, IDS.bob]);
      expect(view.totalSupply).to.equal(CONFIG.curveSupply + CONFIG.lpSupply);
    });

    it("uses extra ETH as the creator's first buy and records it", async () => {
      const fx = await loadFixture(deploy);
      const token = await createToken(fx, fx.alice, { value: E("0.1") });
      expect(await token.balanceOf(fx.alice.address)).to.be.gt(0);
      expect(await fx.launchpad.tradeCount(await token.getAddress())).to.equal(1);
    });

    it("rejects splits the signer did not attest", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, vault, signer, alice, bob } = fx;
      const good = await split(vault, signer, alice.address);

      const swapIds = { ...good, xIds: [IDS.carol, IDS.bob] };
      const renamed = { ...good, handles: ["mallory", "bob"] };
      const forged = { ...good, attestation: await attest(vault, alice, alice.address, good.xIds, good.handles, good.deadline) };
      for (const s of [swapIds, renamed, forged]) {
        await expect(launchpad.connect(alice).createToken("A", "A", "", s, 0)).to.be.revertedWithCustomError(vault, "BadSignature");
      }
      // Attestations are bound to the creator.
      await expect(launchpad.connect(bob).createToken("A", "A", "", good, 0)).to.be.revertedWithCustomError(vault, "BadSignature");

      const expired = await split(vault, signer, alice.address, { deadline: BigInt((await time.latest()) - 1) });
      await expect(launchpad.connect(alice).createToken("A", "A", "", expired, 0)).to.be.revertedWithCustomError(vault, "Expired");
    });

    it("rejects malformed splits", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, vault, signer, alice } = fx;
      const bad = [
        { handles: ["alice"], bps: [9999] },
        { handles: ["alice", "bob"], xIds: [IDS.alice, IDS.alice], bps: [5000, 5000] },
        { handles: ["alice"], xIds: [0n], bps: [10000] },
        { handles: ["alice", "bob"], bps: [10000, 0] },
        { handles: Array.from({ length: 11 }, (_, i) => `u${i}`), xIds: Array.from({ length: 11 }, (_, i) => BigInt(i + 1)), bps: Array(10).fill(1000).concat([0]) },
      ];
      for (const opts of bad) {
        const s = await split(vault, signer, alice.address, opts);
        await expect(launchpad.connect(alice).createToken("A", "A", "", s, 0)).to.be.revertedWithCustomError(vault, "InvalidSplit");
      }
      const s = await split(vault, signer, alice.address);
      await expect(
        launchpad.connect(alice).createToken("A", "A", "", { ...s, handles: ["alice"] }, 0)
      ).to.be.revertedWithCustomError(vault, "InvalidSplit");
    });

    it("validates metadata and the creation fee", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, vault, signer, owner, alice } = fx;
      const s = await split(vault, signer, alice.address);
      await expect(launchpad.connect(alice).createToken("", "A", "", s, 0)).to.be.revertedWithCustomError(launchpad, "InvalidMetadata");
      await expect(launchpad.connect(alice).createToken("A", "TOOLONGSYMBOL", "", s, 0)).to.be.revertedWithCustomError(launchpad, "InvalidMetadata");
      await expect(launchpad.connect(alice).createToken("A", "A", "x".repeat(2001), s, 0)).to.be.revertedWithCustomError(launchpad, "InvalidMetadata");

      await launchpad.connect(owner).setFees(100, 2000, 0, E("0.01"));
      await expect(launchpad.connect(alice).createToken("A", "A", "", s, 0, { value: E("0.005") })).to.be.revertedWithCustomError(
        launchpad,
        "InsufficientPayment"
      );
      await launchpad.connect(alice).createToken("A", "A", "", s, 0, { value: E("0.01") });
      expect(await launchpad.protocolFees()).to.equal(E("0.01"));
    });

    it("never lets a fee raise silently eat the creator's first buy", async () => {
      const { launchpad, vault, signer, owner, alice } = await loadFixture(deploy);
      const s = await split(vault, signer, alice.address);
      // What a 0.1 ETH first buy gets at a zero creation fee; the UI asks for that minus 1%.
      await launchpad.connect(alice).createToken("A", "A", "", s, 0, { value: E("0.1") });
      const first = await launchpad.allTokens(0);
      const bought = (await launchpad.curveSupplyOf(first)) - (await launchpad.getToken(first)).market.realToken;
      const min = (bought * 99n) / 100n;

      // The owner raises the fee while the next launch is in flight: the launch reverts instead.
      await launchpad.connect(owner).setFees(100, 2000, 0, E("0.05"));
      await expect(launchpad.connect(alice).createToken("B", "B", "", s, min, { value: E("0.1") })).to.be.revertedWithCustomError(
        launchpad,
        "Slippage"
      );
      // Even when nothing is left for the buy at all.
      await expect(launchpad.connect(alice).createToken("C", "C", "", s, 1, { value: E("0.05") })).to.be.revertedWithCustomError(
        launchpad,
        "Slippage"
      );
      // Without a minimum, paying exactly the fee is a plain launch with no buy.
      await launchpad.connect(alice).createToken("D", "D", "", s, 0, { value: E("0.05") });
    });
  });

  describe("bonding curve", () => {
    it("buys along the curve and splits the fee by X id", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, vault, alice, bob } = fx;
      const token = await createToken(fx, alice);
      const addr = await token.getAddress();

      const [quoted, fee] = await launchpad.quoteBuy(addr, E("1"));
      await expect(launchpad.connect(bob).buy(addr, quoted, { value: E("1") })).to.emit(launchpad, "Trade");
      expect(await token.balanceOf(bob.address)).to.equal(quoted);

      expect(fee).to.equal(E("0.01"));
      const protocolCut = (fee * 2000n) / 10000n;
      const creatorCut = fee - protocolCut;
      expect(await launchpad.protocolFees()).to.equal(protocolCut);
      expect(await vault.claimable(IDS.alice)).to.equal((creatorCut * 6000n) / 10000n);
      expect(await vault.claimable(IDS.bob)).to.equal(creatorCut - (creatorCut * 6000n) / 10000n);
      expect(await vault.tokenFees(addr)).to.equal(creatorCut);
      expect(await vault.totalDeposited()).to.equal(creatorCut);

      const [claimable, earned] = await vault.earningsOf([IDS.alice, IDS.bob, IDS.carol]);
      expect(claimable[2]).to.equal(0);
      expect(earned[0]).to.equal(claimable[0]);
    });

    it("reverts when slippage is exceeded", async () => {
      const fx = await loadFixture(deploy);
      const token = await createToken(fx, fx.alice);
      const addr = await token.getAddress();
      const [quoted] = await fx.launchpad.quoteBuy(addr, E("1"));
      await expect(fx.launchpad.connect(fx.bob).buy(addr, quoted + 1n, { value: E("1") })).to.be.revertedWithCustomError(
        fx.launchpad,
        "Slippage"
      );
    });

    it("sells back without an approval", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, alice, bob } = fx;
      const token = await createToken(fx, alice);
      const addr = await token.getAddress();

      await launchpad.connect(bob).buy(addr, 0, { value: E("1") });
      const bal = await token.balanceOf(bob.address);
      const [ethOut] = await launchpad.quoteSell(addr, bal);
      expect(await ethDelta(bob, () => launchpad.connect(bob).sell(addr, bal, ethOut))).to.equal(ethOut);
      expect(await token.balanceOf(bob.address)).to.equal(0);

      // Round trip loses roughly two fees, and the curve is back at its start.
      expect(ethOut).to.be.lt(E("0.99"));
      expect(ethOut).to.be.gt(E("0.97"));
      const m = await launchpad.markets(addr);
      expect(m.realToken).to.equal(CONFIG.curveSupply);
      expect(m.virtualEth).to.be.gte(CONFIG.virtualEth);
    });

    it("lets holders transfer freely", async () => {
      const fx = await loadFixture(deploy);
      const token = await createToken(fx, fx.alice);
      await fx.launchpad.connect(fx.bob).buy(await token.getAddress(), 0, { value: E("0.1") });
      await token.connect(fx.bob).transfer(fx.carol.address, 1000n);
      expect(await token.balanceOf(fx.carol.address)).to.equal(1000n);
    });
  });

  describe("graduation to the PonSwap pool", () => {
    it("caps the final buy, refunds the excess and seeds the pool at the curve's final price", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, owner, alice, bob } = fx;
      await launchpad.connect(owner).setFees(100, 2000, 500, 0);
      const token = await createToken(fx, alice);
      const addr = await token.getAddress();

      const [out, fee, refund] = await launchpad.quoteBuy(addr, E("10"));
      expect(out).to.equal(CONFIG.curveSupply);
      expect(refund).to.be.gt(0);

      const delta = await ethDelta(bob, () => launchpad.connect(bob).buy(addr, 0, { value: E("10") }));
      expect(delta).to.equal(refund - E("10"));

      const m = await launchpad.markets(addr);
      expect(m.graduated).to.equal(true);
      expect(m.graduatedAt).to.be.gt(0);
      expect(m.lpSupply).to.equal(0);
      expect(m.realToken).to.equal(CONFIG.lpSupply);
      expect(m.virtualToken).to.equal(m.realToken);
      expect(m.virtualEth).to.equal(m.realEth);

      const curveEth = E("10") - fee - refund;
      const gradFee = (curveEth * 500n) / 10000n;
      expect(m.realEth).to.equal(curveEth - gradFee);

      // Pool price stays within 6% of the curve's final price (5% graduation fee + rounding).
      const trades = await launchpad.getTrades(addr, 0, 10);
      const curveEnd = trades[trades.length - 1].price;
      const poolPrice = (m.realEth * E("1")) / m.realToken;
      expect(poolPrice).to.be.lte(curveEnd);
      expect(poolPrice).to.be.gt((curveEnd * 94n) / 100n);
    });

    it("keeps trading in the pool and keeps paying the X accounts", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, vault, alice, bob, carol } = fx;
      const token = await createToken(fx, alice);
      const addr = await token.getAddress();
      await graduate(launchpad, token, bob);

      const feesBefore = await vault.tokenFees(addr);
      const k0 = ((m) => m.realEth * m.realToken)(await launchpad.markets(addr));

      const [out] = await launchpad.quoteBuy(addr, E("2"));
      await launchpad.connect(carol).buy(addr, out, { value: E("2") });
      expect(await token.balanceOf(carol.address)).to.equal(out);

      const bal = await token.balanceOf(bob.address);
      const [ethOut] = await launchpad.quoteSell(addr, bal / 2n);
      expect(await ethDelta(bob, () => launchpad.connect(bob).sell(addr, bal / 2n, ethOut))).to.equal(ethOut);

      const m = await launchpad.markets(addr);
      expect(m.virtualEth).to.equal(m.realEth);
      expect(m.virtualToken).to.equal(m.realToken);
      expect(m.realEth * m.realToken).to.be.gte(k0);
      expect(await vault.tokenFees(addr)).to.be.gt(feesBefore);
    });

    it("stays solvent across mixed curve and pool trading", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, alice, bob, carol } = fx;
      const tokenA = await createToken(fx, alice);
      const tokenB = await createToken(fx, alice, { handles: ["carol"], bps: [10000] });
      const a = await tokenA.getAddress();
      const b = await tokenB.getAddress();

      for (const v of ["0.3", "0.07", "1.2", "0.0001", "0.5"]) {
        await launchpad.connect(bob).buy(a, 0, { value: E(v) });
        await launchpad.connect(carol).buy(a, 0, { value: E(v) });
        await launchpad.connect(carol).buy(b, 0, { value: E(v) });
      }
      await graduate(launchpad, tokenB, bob);
      await launchpad.connect(carol).buy(b, 0, { value: E("0.8") });
      for (const [who, token] of [[bob, tokenA], [carol, tokenA], [bob, tokenB], [carol, tokenB]]) {
        const addr = await token.getAddress();
        const bal = await token.balanceOf(who.address);
        if (bal === 0n) continue;
        await launchpad.connect(who).sell(addr, bal / 3n, 0);
        await launchpad.connect(who).sell(addr, await token.balanceOf(who.address), 0);
      }

      const lp = await launchpad.getAddress();
      const [ma, mb] = [await launchpad.markets(a), await launchpad.markets(b)];
      expect(await ethers.provider.getBalance(lp)).to.equal(ma.realEth + mb.realEth + (await launchpad.protocolFees()));
      expect(await tokenA.balanceOf(lp)).to.equal(ma.realToken + ma.lpSupply);
      expect(await tokenB.balanceOf(lp)).to.equal(mb.realToken);
      expect(ma.realToken).to.equal(CONFIG.curveSupply);
    });
  });

  describe("trade history", () => {
    it("records trades per token and globally", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, alice, bob, carol } = fx;
      const tokenA = await createToken(fx, alice);
      const tokenB = await createToken(fx, alice);
      const a = await tokenA.getAddress();
      const b = await tokenB.getAddress();

      await launchpad.connect(bob).buy(a, 0, { value: E("0.2") });
      await launchpad.connect(carol).buy(b, 0, { value: E("0.3") });
      const bal = await tokenA.balanceOf(bob.address);
      await launchpad.connect(bob).sell(a, bal, 0);

      const trades = await launchpad.getTrades(a, 0, 50);
      expect(trades).to.have.length(2);
      expect(trades[0].trader).to.equal(bob.address);
      expect(trades[0].isBuy).to.equal(true);
      expect(trades[0].ethAmount).to.equal(E("0.2"));
      expect(trades[0].tokenAmount).to.equal(bal);
      expect(trades[1].isBuy).to.equal(false);
      expect(trades[1].price).to.be.lt(trades[0].price);
      expect(await launchpad.getTrades(a, 1, 50)).to.have.length(1);
      expect(await launchpad.getTrades(a, 5, 50)).to.have.length(0);

      const recent = await launchpad.getRecentTrades(2);
      expect(recent.map((r) => r.token)).to.deep.equal([a, b]);
      expect(recent[0].symbol).to.equal("PON");
      expect(recent[0].trade.isBuy).to.equal(false);
      expect(await launchpad.globalTradeCount()).to.equal(3);

      const view = await launchpad.getToken(a);
      expect(view.tradeCount).to.equal(2);
      expect(view.lastTradeAt).to.equal(trades[1].timestamp);
    });
  });

  describe("claims", () => {
    it("pays an X account's balance to the signed wallet", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, vault, signer, alice, bob, carol } = fx;
      const token = await createToken(fx, alice);
      await launchpad.connect(bob).buy(await token.getAddress(), 0, { value: E("2") });

      const owed = await vault.claimable(IDS.alice);
      expect(owed).to.be.gt(0);
      const deadline = (await time.latest()) + 3600;
      const sig = await signClaim(vault, signer, IDS.alice, carol.address, deadline);

      // Anyone can relay the claim; funds go to the signed destination.
      const before = await ethers.provider.getBalance(carol.address);
      await expect(vault.connect(bob).claim(IDS.alice, carol.address, deadline, sig))
        .to.emit(vault, "Claimed")
        .withArgs(IDS.alice, carol.address, owed);
      expect(await ethers.provider.getBalance(carol.address)).to.equal(before + owed);
      expect(await vault.claimable(IDS.alice)).to.equal(0);
      expect(await vault.totalEarned(IDS.alice)).to.equal(owed);

      await launchpad.connect(bob).buy(await token.getAddress(), 0, { value: E("1") });
      await expect(vault.claim(IDS.alice, carol.address, deadline, sig)).to.be.revertedWithCustomError(vault, "BadSignature");
    });

    it("rejects wrong signer, destination, account and expired signatures", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, vault, signer, alice, bob, carol } = fx;
      const token = await createToken(fx, alice);
      await launchpad.connect(bob).buy(await token.getAddress(), 0, { value: E("1") });
      const deadline = (await time.latest()) + 3600;

      const forged = await signClaim(vault, alice, IDS.alice, alice.address, deadline);
      await expect(vault.claim(IDS.alice, alice.address, deadline, forged)).to.be.revertedWithCustomError(vault, "BadSignature");

      const sig = await signClaim(vault, signer, IDS.alice, carol.address, deadline);
      await expect(vault.claim(IDS.alice, bob.address, deadline, sig)).to.be.revertedWithCustomError(vault, "BadSignature");
      await expect(vault.claim(IDS.bob, carol.address, deadline, sig)).to.be.revertedWithCustomError(vault, "BadSignature");

      const past = (await time.latest()) - 1;
      const old = await signClaim(vault, signer, IDS.alice, carol.address, past);
      await expect(vault.claim(IDS.alice, carol.address, past, old)).to.be.revertedWithCustomError(vault, "Expired");
    });

    it("reverts when there is nothing to claim", async () => {
      const { vault, signer, carol } = await loadFixture(deploy);
      const deadline = (await time.latest()) + 3600;
      const sig = await signClaim(vault, signer, 999n, carol.address, deadline);
      await expect(vault.claim(999n, carol.address, deadline, sig)).to.be.revertedWithCustomError(vault, "NothingToClaim");
    });
  });

  describe("mainnet safety", () => {
    it("snapshots fee terms per token so live tokens never change", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, vault, owner, alice, bob } = fx;
      const tokenA = await createToken(fx, alice);
      const a = await tokenA.getAddress();

      await launchpad.connect(owner).setFees(500, 5000, 1000, 0);
      const tokenB = await createToken(fx, alice);
      const b = await tokenB.getAddress();

      const [, feeA] = await launchpad.quoteBuy(a, E("1"));
      const [, feeB] = await launchpad.quoteBuy(b, E("1"));
      expect(feeA).to.equal(E("0.01"));
      expect(feeB).to.equal(E("0.05"));

      const before = await vault.tokenFees(a);
      await launchpad.connect(bob).buy(a, 0, { value: E("1") });
      // Old token still pays 80% of a 1% fee to the X accounts.
      expect((await vault.tokenFees(a)) - before).to.equal(E("0.008"));

      const m = await launchpad.markets(a);
      expect([m.feeBps, m.protocolShareBps, m.graduationFeeBps]).to.deep.equal([100n, 2000n, 0n]);
    });

    it("caps the protocol share so X accounts always get at least half", async () => {
      const { launchpad } = await loadFixture(deploy);
      await expect(launchpad.setFees(100, 5001, 0, 0)).to.be.revertedWithCustomError(launchpad, "InvalidConfig");
      await launchpad.setFees(100, 5000, 0, 0);
    });

    it("can pause new launches but never trading", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, vault, signer, owner, alice, bob } = fx;
      const token = await createToken(fx, alice);
      await expect(launchpad.connect(alice).setLaunchesPaused(true)).to.be.revertedWithCustomError(launchpad, "OwnableUnauthorizedAccount");
      await expect(launchpad.connect(owner).setLaunchesPaused(true)).to.emit(launchpad, "LaunchesPausedSet").withArgs(true);

      const s = await split(vault, signer, alice.address);
      await expect(launchpad.connect(alice).createToken("A", "A", "", s, 0)).to.be.revertedWithCustomError(launchpad, "LaunchesPaused");
      // Existing tokens keep trading.
      await launchpad.connect(bob).buy(await token.getAddress(), 0, { value: E("0.1") });
      await launchpad.connect(bob).sell(await token.getAddress(), await token.balanceOf(bob.address), 0);

      await launchpad.connect(owner).setLaunchesPaused(false);
      await launchpad.connect(alice).createToken("A", "A", "", s, 0);
    });

    it("lets the owner freeze claims and rotate a leaked signer", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, vault, signer, owner, alice, bob, carol } = fx;
      const token = await createToken(fx, alice);
      await launchpad.connect(bob).buy(await token.getAddress(), 0, { value: E("1") });
      const deadline = (await time.latest()) + 3600;
      const leaked = await signClaim(vault, signer, IDS.alice, bob.address, deadline);

      await expect(vault.connect(alice).setClaimsPaused(true)).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await vault.connect(owner).setClaimsPaused(true);
      await expect(vault.claim(IDS.alice, bob.address, deadline, leaked)).to.be.revertedWithCustomError(vault, "ClaimsPaused");

      await vault.connect(owner).setSigner(carol.address);
      await vault.connect(owner).setClaimsPaused(false);
      await expect(vault.claim(IDS.alice, bob.address, deadline, leaked)).to.be.revertedWithCustomError(vault, "BadSignature");

      const fresh = await signClaim(vault, carol, IDS.alice, alice.address, deadline);
      await vault.claim(IDS.alice, alice.address, deadline, fresh);
      expect(await vault.claimable(IDS.alice)).to.equal(0);
    });

    it("transfers ownership in two steps", async () => {
      const { launchpad, vault, owner, alice, bob } = await loadFixture(deploy);
      for (const c of [launchpad, vault]) {
        await c.connect(owner).transferOwnership(alice.address);
        expect(await c.owner()).to.equal(owner.address);
        expect(await c.pendingOwner()).to.equal(alice.address);
        await expect(c.connect(bob).acceptOwnership()).to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount");
        await c.connect(alice).acceptOwnership();
        expect(await c.owner()).to.equal(alice.address);
      }
    });

    it("refuses to withdraw protocol fees to the zero address", async () => {
      const { launchpad } = await loadFixture(deploy);
      await expect(launchpad.withdrawProtocolFees(ethers.ZeroAddress)).to.be.revertedWithCustomError(launchpad, "ZeroAddress");
    });
  });

  describe("admin", () => {
    it("restricts privileged functions to their owners", async () => {
      const { launchpad, vault, alice } = await loadFixture(deploy);
      await expect(launchpad.connect(alice).setFees(0, 0, 0, 0)).to.be.revertedWithCustomError(launchpad, "OwnableUnauthorizedAccount");
      await expect(launchpad.connect(alice).setCurveConfig(CONFIG)).to.be.revertedWithCustomError(launchpad, "OwnableUnauthorizedAccount");
      await expect(vault.connect(alice).setSigner(alice.address)).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await expect(vault.setLaunchpad(alice.address)).to.be.revertedWithCustomError(vault, "LaunchpadAlreadySet");
      await expect(vault.connect(alice).setSplit(alice.address, alice.address, [1n], ["x"], [10000], 0, "0x")).to.be.revertedWithCustomError(
        vault,
        "OnlyLaunchpad"
      );
    });

    it("caps fees and withdraws protocol fees", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, owner, alice, bob, carol } = fx;
      await expect(launchpad.setFees(501, 0, 0, 0)).to.be.revertedWithCustomError(launchpad, "InvalidConfig");
      await expect(launchpad.setFees(100, 10001, 0, 0)).to.be.revertedWithCustomError(launchpad, "InvalidConfig");
      await expect(launchpad.setFees(100, 0, 1001, 0)).to.be.revertedWithCustomError(launchpad, "InvalidConfig");
      await expect(launchpad.setFees(100, 0, 0, E("0.1") + 1n)).to.be.revertedWithCustomError(launchpad, "InvalidConfig");
      await launchpad.setFees(100, 2000, 0, E("0.1"));
      await launchpad.setFees(100, 2000, 0, 0);

      const token = await createToken(fx, alice);
      await launchpad.connect(bob).buy(await token.getAddress(), 0, { value: E("1") });
      const fees = await launchpad.protocolFees();
      const before = await ethers.provider.getBalance(carol.address);
      await launchpad.connect(owner).withdrawProtocolFees(carol.address);
      expect(await ethers.provider.getBalance(carol.address)).to.equal(before + fees);
      expect(await launchpad.protocolFees()).to.equal(0);
    });

    it("pages tokens newest first", async () => {
      const fx = await loadFixture(deploy);
      const { launchpad, vault, signer, alice } = fx;
      for (const sym of ["A", "B", "C"]) {
        await launchpad.connect(alice).createToken(sym, sym, "", await split(vault, signer, alice.address), 0);
      }
      expect((await launchpad.getTokens(0, 2)).map((t) => t.symbol)).to.deep.equal(["C", "B"]);
      expect((await launchpad.getTokens(2, 10)).map((t) => t.symbol)).to.deep.equal(["A"]);
      expect(await launchpad.getTokens(5, 10)).to.have.length(0);
      const unknown = await launchpad.getToken(alice.address);
      expect(unknown.token).to.equal(ethers.ZeroAddress);
    });
  });
});
