const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployUniswapLocal, deployPonsCopy, deploySplitEarn, vendor } = require("../scripts/lib/pons-stack");

// Everything below runs on the real code: Uniswap v4 and Permit2 built from their verified sources,
// a copy of Pons v2 built from its verified mainnet sources (contracts/vendor), and SplitEarn.

const E = ethers.parseEther;
const BPS = 10_000n;
const IDS = { alice: 1001n, bob: 2002n, carol: 3003n };
const SOCIALS = { twitter: "", telegram: "", discord: "", website: "", farcaster: "" };

async function deploy() {
  const [owner, signer, alice, bob, carol, trader] = await ethers.getSigners();
  const uni = await deployUniswapLocal(owner);
  const stack = await deployPonsCopy(owner, uni);
  const earn = await deploySplitEarn(owner, { signer: signer.address, ponsFactory: stack.factory });
  const at = (name, address) => new ethers.Contract(address, vendor(name).abi, owner);
  const pons = at("PonsV2LaunchFactory", stack.factory);
  const vault = await ethers.getContractAt("FeeVault", earn.feeVault);
  const launcher = await ethers.getContractAt("SplitEarnLauncher", earn.launcher);
  const router = await ethers.getContractAt("SplitEarnRouter", await launcher.router());
  const hook = at("PonsV2MemeHook", stack.hook);
  const escrow = at("PonsV2FeeEscrow", stack.escrow);
  // Pons's fee sweep operator is the owner of this copy (Pons's keeper plays that role on mainnet).
  return { owner, operator: owner, signer, alice, bob, carol, trader, pons, vault, launcher, router, hook, escrow };
}

async function domain(vault) {
  const { chainId } = await ethers.provider.getNetwork();
  return { name: "SplitEarn FeeVault", version: "1", chainId, verifyingContract: await vault.getAddress() };
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

async function split(fx, creator, { handles = ["alice", "bob"], xIds, bps = [6000, 4000], deadline } = {}) {
  xIds = xIds ?? handles.map((h) => IDS[h] ?? BigInt(h.length) * 7919n);
  deadline = deadline ?? BigInt((await time.latest()) + 600);
  const attestation = await attest(fx.vault, fx.signer, creator, xIds, handles, deadline);
  return { xIds, handles, bps, deadline, attestation };
}

let saltCounter = 0n;
function params(overrides = {}) {
  return {
    name: "Pon Coin",
    symbol: "PON",
    logo: "ipfs://logo",
    description: "gm",
    socials: SOCIALS,
    creatorTaxBps: 0,
    salt: ethers.toBeHex(++saltCounter, 32),
    expectedEconomics: ethers.ZeroHash,
    ...overrides,
  };
}

/** Launches through the launcher and returns handles on the coin, its curve and its splitter. */
async function launch(fx, from, { firstBuy = 0n, minTokensOut = 0n, tax = 0, split: s, ...opts } = {}) {
  s = s ?? (await split(fx, from.address, opts));
  const fee = await fx.pons.launchFee();
  const tx = await fx.launcher
    .connect(from)
    .launch(params({ creatorTaxBps: tax, ...opts.params }), s, firstBuy, minTokensOut, await fx.launcher.termsVersion(), { value: fee + firstBuy });
  const receipt = await tx.wait();
  const log = receipt.logs.map((l) => fx.launcher.interface.parseLog(l)).find((l) => l?.name === "Launched");
  return {
    token: new ethers.Contract(log.args.token, vendor("PonsV2LauncherToken").abi, fx.owner),
    curve: new ethers.Contract(log.args.curve, vendor("PonsV2BondingCurve").abi, fx.owner),
    splitter: await ethers.getContractAt("FeeSplitter", log.args.splitter),
    tokensOut: log.args.tokensOut,
    receipt,
  };
}

async function pastSnipeWindow() {
  await time.increase(10);
}

/** Buys the curve out (phase 1) and creates the pool (phase 2). */
async function graduate(fx, c, buyer = fx.trader) {
  await pastSnipeWindow();
  await c.curve.connect(buyer).buy(E("10"), 0, buyer.address, { value: E("10") });
  expect((await fx.pons.getLaunchedToken(await c.token.getAddress())).phase).to.equal(1);
  await fx.pons.createGraduatedPool(await c.token.getAddress());
}

/** ETH `who` gained from a transaction someone else sent. */
async function received(who, fn) {
  const before = await ethers.provider.getBalance(who.address);
  await (await fn()).wait();
  return (await ethers.provider.getBalance(who.address)) - before;
}

/** ETH `who` gained from a transaction they sent themselves, ignoring gas. */
async function ethDelta(who, fn) {
  const before = await ethers.provider.getBalance(who.address);
  const receipt = await (await fn()).wait();
  const after = await ethers.provider.getBalance(who.address);
  return after - before + receipt.gasUsed * receipt.gasPrice;
}

describe("SplitEarnLauncher", () => {
  describe("launch", () => {
    it("launches on Pons with the coin's splitter as the creator fee recipient", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice);
      const token = await c.token.getAddress();
      const rec = await fx.pons.getLaunchedToken(token);
      expect(rec.deployer).to.equal(await fx.launcher.getAddress());
      expect(rec.creatorFeeRecipient).to.equal(await c.splitter.getAddress());
      expect(rec.buybackEnabled).to.equal(false);
      expect(rec.pairToken).to.equal(ethers.ZeroAddress);
      expect(await c.token.balanceOf(await c.curve.getAddress())).to.equal(await c.token.totalSupply());

      const l = await fx.launcher.launchOf(token);
      expect(l.creator).to.equal(fx.alice.address);
      expect(l.createdBlock).to.equal(c.receipt.blockNumber);
      expect(l.splitter).to.equal(await c.splitter.getAddress());
      expect(l.platformBps).to.equal(2000);
      expect(await c.splitter.token()).to.equal(token);
      expect(await c.splitter.platformBps()).to.equal(2000);
      expect(await fx.launcher.isSplitter(await c.splitter.getAddress())).to.equal(true);

      const onchain = await fx.vault.getSplit(token);
      expect(onchain.map((r) => r.xId)).to.deep.equal([IDS.alice, IDS.bob]);
      expect(await fx.vault.tokensOf(IDS.bob)).to.deep.equal([token]);

      const v = await fx.launcher.getLaunch(token);
      expect(v.name).to.equal("Pon Coin");
      expect(v.logo).to.equal("ipfs://logo");
      expect(v.handles).to.deep.equal(["alice", "bob"]);
      expect(v.xIds).to.deep.equal([IDS.alice, IDS.bob]);
      expect(v.phase).to.equal(0);
      expect(v.quoteReserve).to.equal(E("1.68"));
      expect(v.threshold).to.equal(E("4.2"));
      expect(v.phantomQuote).to.equal(E("1.68"));
      expect(v.reservedTokens).to.equal((E("1000000000") * E("1.68")) / E("5.88"));
      expect(v.feeRecipient).to.equal(await c.splitter.getAddress());
    });

    it("records the launch block without burning gas where ArbSys is only Arbitrum's placeholder code", async () => {
      // A local fork of Robinhood Chain has 0xfe (INVALID) at the ArbSys address; the launcher's
      // stipend keeps that call from eating the launch's gas, and it falls back to block.number.
      const fx = await loadFixture(deploy);
      const plain = await launch(fx, fx.alice, { firstBuy: E("0.1") });
      await ethers.provider.send("hardhat_setCode", ["0x0000000000000000000000000000000000000064", "0xfe"]);
      const forked = await launch(fx, fx.alice, { firstBuy: E("0.1") });
      const l = await fx.launcher.launchOf(await forked.token.getAddress());
      expect(l.createdBlock).to.equal(forked.receipt.blockNumber);
      expect(forked.receipt.gasUsed).to.be.lt(plain.receipt.gasUsed + 25_000n);
    });

    it("gives SplitEarn 20% of the standard creator fee, whatever the creator tax", async () => {
      const fx = await loadFixture(deploy);
      // 70 bps of volume is the creator's part of Pons's fee; SplitEarn takes 14 bps of it.
      expect(await fx.launcher.platformBpsFor(100, 3000, 0)).to.equal(2000);
      expect(await fx.launcher.platformBpsFor(100, 3000, 300)).to.equal(378); // 14 / (70 + 300)
      expect(await fx.launcher.platformBpsFor(100, 3000, 1000)).to.equal(130); // 14 / (70 + 1000)
      const c = await launch(fx, fx.alice, { tax: 500 });
      expect((await fx.launcher.launchOf(await c.token.getAddress())).platformBps).to.equal(245);
      expect((await fx.pons.getLaunchedToken(await c.token.getAddress())).creatorTaxBps).to.equal(500);
    });

    it("buys for the launcher in the same transaction, free of Pons's snipe tax", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice, { firstBuy: E("0.1") });
      const bought = await c.token.balanceOf(fx.alice.address);
      expect(bought).to.equal(c.tokensOut);
      // Untaxed: 0.1 ETH less the 1% fee against 1.68 ETH of virtual reserve.
      const net = E("0.1") - E("0.001");
      expect(bought).to.equal((net * E("1000000000")) / (E("1.68") + net));
      expect(await c.curve.snipeTaxExempt(fx.alice.address)).to.equal(true);
      // Someone else in the same second pays the full opening tax.
      expect(await c.curve.currentSnipeTaxBps(fx.bob.address)).to.equal(9900);
    });

    it("refunds the part of a first buy the curve could not fill", async () => {
      const fx = await loadFixture(deploy);
      const before = await ethers.provider.getBalance(fx.alice.address);
      const { receipt } = await launch(fx, fx.alice, { firstBuy: E("20") });
      const spent = (await ethers.provider.getBalance(fx.alice.address)) - before + receipt.gasUsed * receipt.gasPrice;
      // Pons fee + what it took to buy the curve out (4.2 ETH of reserve, grossed up by the 1% fee).
      expect(-spent).to.be.lt(E("4.3"));
      expect(-spent).to.be.gt(E("4.2"));
    });

    it("pins the value, the terms and Pons's economics", async () => {
      const fx = await loadFixture(deploy);
      const { launcher, alice, pons } = fx;
      const s = await split(fx, alice.address);
      const fee = await pons.launchFee();
      const v = await launcher.termsVersion();
      await expect(launcher.connect(alice).launch(params(), s, E("0.1"), 0, v, { value: fee })).to.be.revertedWithCustomError(launcher, "WrongValue");
      await expect(launcher.connect(alice).launch(params(), s, 0, 0, v + 1n, { value: fee })).to.be.revertedWithCustomError(launcher, "TermsChanged");
      await expect(
        launcher.connect(alice).launch(params({ expectedEconomics: ethers.id("stale") }), s, 0, 0, v, { value: fee })
      ).to.be.revertedWithCustomError(pons, "LaunchEconomicsMismatch");
      const pin = await pons.previewLaunchEconomics(0, ethers.ZeroAddress);
      await launcher.connect(alice).launch(params({ expectedEconomics: pin }), s, 0, 0, v, { value: fee });
      await pons.setLaunchFee(E("0.001"));
      await expect(launcher.connect(alice).launch(params(), await split(fx, alice.address), 0, 0, v, { value: fee })).to.be.revertedWithCustomError(launcher, "WrongValue");
    });

    it("bumps the terms version when SplitEarn's terms change", async () => {
      const fx = await loadFixture(deploy);
      const v = await fx.launcher.termsVersion();
      await fx.launcher.setPlatformShareBps(1500);
      await fx.launcher.setLaunchConfigId(0);
      expect(await fx.launcher.termsVersion()).to.equal(v + 2n);
      await expect(fx.launcher.setPlatformShareBps(3001)).to.be.revertedWithCustomError(fx.launcher, "ShareTooHigh");
      await expect(fx.launcher.connect(fx.alice).setPlatformShareBps(1)).to.be.revertedWithCustomError(fx.launcher, "OwnableUnauthorizedAccount");
      const c = await launch(fx, fx.alice);
      expect(await c.splitter.platformBps()).to.equal(1500);
    });

    it("rejects splits the signer did not attest for this launcher", async () => {
      const fx = await loadFixture(deploy);
      const { launcher, vault, alice, bob, pons } = fx;
      const good = await split(fx, alice.address);
      const fee = await pons.launchFee();
      const v = await launcher.termsVersion();
      const forged = { ...good, attestation: await attest(vault, alice, alice.address, good.xIds, good.handles, good.deadline) };
      await expect(launcher.connect(alice).launch(params(), forged, 0, 0, v, { value: fee })).to.be.revertedWithCustomError(vault, "BadSignature");
      await expect(launcher.connect(bob).launch(params(), good, 0, 0, v, { value: fee })).to.be.revertedWithCustomError(vault, "BadSignature");
      const renamed = { ...good, handles: ["mallory", "bob"] };
      await expect(launcher.connect(alice).launch(params(), renamed, 0, 0, v, { value: fee })).to.be.revertedWithCustomError(vault, "BadSignature");
      const expired = await split(fx, alice.address, { deadline: BigInt((await time.latest()) - 1) });
      await expect(launcher.connect(alice).launch(params(), expired, 0, 0, v, { value: fee })).to.be.revertedWithCustomError(vault, "Expired");
      const uneven = await split(fx, alice.address, { bps: [6000, 3000] });
      await expect(launcher.connect(alice).launch(params(), uneven, 0, 0, v, { value: fee })).to.be.revertedWithCustomError(vault, "InvalidSplit");
    });

    it("stops when launches are paused, Pons closes its gate, or the tax is over Pons's cap", async () => {
      const fx = await loadFixture(deploy);
      const { launcher, alice, pons } = fx;
      const fee = await pons.launchFee();
      await launcher.setLaunchesPaused(true);
      await expect(launcher.connect(alice).launch(params(), await split(fx, alice.address), 0, 0, 1, { value: fee })).to.be.revertedWithCustomError(launcher, "LaunchesPaused");
      await launcher.setLaunchesPaused(false);
      await pons.setLaunchEnabled(false);
      const terms = await launcher.launchTerms();
      expect(terms.canLaunch).to.equal(false);
      await expect(launcher.connect(alice).launch(params(), await split(fx, alice.address), 0, 0, 1, { value: fee })).to.be.revertedWithCustomError(pons, "NotWhitelisted");
      await pons.setLaunchEnabled(true);
      await expect(
        launcher.connect(alice).launch(params({ creatorTaxBps: 1001 }), await split(fx, alice.address), 0, 0, 1, { value: fee })
      ).to.be.revertedWithCustomError(pons, "CreatorTaxTooHigh");
    });

    it("accepts no stray ETH", async () => {
      const fx = await loadFixture(deploy);
      await expect(fx.alice.sendTransaction({ to: await fx.launcher.getAddress(), value: 1 })).to.be.revertedWithCustomError(fx.launcher, "UnexpectedEth");
      await expect(fx.launcher.connect(fx.alice).platformFeeIn(ethers.ZeroAddress, { value: 1 })).to.be.revertedWithCustomError(fx.launcher, "NotSplitter");
    });

    it("reports the launch terms", async () => {
      const fx = await loadFixture(deploy);
      const t = await fx.launcher.launchTerms();
      expect(t.version).to.equal(1);
      expect(t.platformShare).to.equal(2000);
      expect(t.ponsLaunchFee).to.equal(E("0.0005"));
      expect(t.economics).to.equal(await fx.pons.previewLaunchEconomics(0, ethers.ZeroAddress));
      expect(t.maxCreatorTaxBps).to.equal(1000);
      expect(t.canLaunch).to.equal(true);
      expect(t.paused).to.equal(false);
    });
  });

  describe("fees", () => {
    it("splits curve fees: 20% of the standard creator fee to SplitEarn, the rest to the X accounts", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice);
      const token = await c.token.getAddress();
      await pastSnipeWindow();
      await c.curve.connect(fx.trader).buy(E("1"), 0, fx.trader.address, { value: E("1") });

      // 1% fee = 0.01 ETH; the creator's 70% = 0.007 ETH.
      expect(await c.splitter.pendingFees()).to.equal(E("0.007"));
      expect((await fx.launcher.getLaunch(token)).feesPending).to.equal(E("0.007"));
      await c.splitter.connect(fx.carol).collect();

      expect(await c.curve.quoteFeeBalance()).to.equal(0);
      expect(await fx.launcher.platformFees()).to.equal(E("0.0014"));
      expect(await fx.vault.tokenFees(token)).to.equal(E("0.0056"));
      expect(await fx.vault.claimable(IDS.alice)).to.equal((E("0.0056") * 6000n) / BPS);
      expect(await fx.vault.claimable(IDS.bob)).to.equal(E("0.0056") - (E("0.0056") * 6000n) / BPS);
      expect(await c.splitter.totalCollected()).to.equal(E("0.007"));
      expect(await c.splitter.pendingFees()).to.equal(0);
      // Nothing left: a second collect is a harmless no-op.
      await c.splitter.collect();
      expect(await fx.vault.tokenFees(token)).to.equal(E("0.0056"));
    });

    it("sends the whole creator tax to the X accounts", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice, { tax: 500 });
      await pastSnipeWindow();
      await c.curve.connect(fx.trader).buy(E("1"), 0, fx.trader.address, { value: E("1") });
      await c.splitter.collect();
      const creator = E("0.007") + E("0.05");
      const platform = (creator * 245n) / BPS;
      expect(await fx.launcher.platformFees()).to.equal(platform);
      expect(await fx.vault.tokenFees(await c.token.getAddress())).to.equal(creator - platform);
      // SplitEarn ends up with about 14 bps of the volume, the X accounts with the rest.
      expect(platform).to.be.closeTo(E("0.0014"), E("0.00001"));
    });

    it("counts the snipe tax paid by early buyers into the fees", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice);
      await c.curve.connect(fx.trader).buy(E("1"), 0, fx.trader.address, { value: E("1") });
      expect(await c.curve.quoteFeeBalance()).to.be.gt(E("0.01"));
    });

    it("keeps collecting after graduation: pool fees swept by Pons's keeper, ETH-side fees by the splitter itself", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice);
      const token = await c.token.getAddress();
      await graduate(fx, c);
      // Graduation swept the curve's fees into the escrow on its way out.
      expect(await fx.escrow.balanceOf(await c.splitter.getAddress())).to.be.gt(0);
      await c.splitter.collect();
      const afterCurve = await fx.vault.tokenFees(token);
      expect(afterCurve).to.be.gt(0);

      // A pool buy pays its fee in the coin: only Pons's keeper can convert and sweep it.
      await fx.router.connect(fx.trader).buy(token, 0, fx.trader.address, ethers.MaxUint256, { value: E("1") });
      const poolId = (await fx.launcher.launchOf(token)).poolId;
      expect(await fx.hook.pendingFees(poolId, token)).to.be.gt(0);
      await c.splitter.collect();
      expect(await fx.vault.tokenFees(token)).to.equal(afterCurve);
      await fx.hook.connect(fx.operator).sweepPoolFees(poolId, 1, 0);
      await c.splitter.collect();
      const afterBuy = await fx.vault.tokenFees(token);
      expect(afterBuy).to.be.gt(afterCurve);

      // A pool sell pays its fee in ETH, which the splitter sweeps itself.
      const bal = await c.token.balanceOf(fx.trader.address);
      await c.token.connect(fx.trader).approve(await fx.router.getAddress(), bal);
      await fx.router.connect(fx.trader).sell(token, bal / 2n, 0, fx.trader.address, ethers.MaxUint256);
      const pending = await c.splitter.pendingFees();
      expect(pending).to.be.gt(0);
      await c.splitter.collect();
      expect(await fx.vault.tokenFees(token)).to.equal(afterBuy + pending - (pending * 2000n) / BPS);
      expect(await fx.hook.pendingFees(poolId, ethers.ZeroAddress)).to.equal(0);
    });

    it("splits whatever Pons pushes straight to the splitter", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice);
      await pastSnipeWindow();
      await c.curve.connect(fx.trader).buy(E("1"), 0, fx.trader.address, { value: E("1") });
      await fx.pons.rescueCurveFees(await c.token.getAddress());
      expect(await ethers.provider.getBalance(await c.splitter.getAddress())).to.equal(E("0.007"));
      await c.splitter.collect();
      expect(await fx.vault.tokenFees(await c.token.getAddress())).to.equal(E("0.0056"));
    });

    it("shows when Pons has moved a coin's creator fees elsewhere", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice);
      const token = await c.token.getAddress();
      await fx.pons.setCreatorFeeRecipient(token, fx.carol.address);
      await time.increase(3 * 24 * 3600 + 1);
      await fx.pons.executeCreatorFeeRecipientChange(token);
      expect((await fx.launcher.getLaunch(token)).feeRecipient).to.equal(fx.carol.address);
      await pastSnipeWindow();
      await c.curve.connect(fx.trader).buy(E("1"), 0, fx.trader.address, { value: E("1") });
      // The splitter can no longer sweep; collect still succeeds and pays nothing.
      await c.splitter.collect();
      expect(await fx.vault.tokenFees(token)).to.equal(0);
    });

    it("collects many coins at once and skips what isn't a SplitEarn coin", async () => {
      const fx = await loadFixture(deploy);
      const a = await launch(fx, fx.alice);
      const b = await launch(fx, fx.bob);
      await pastSnipeWindow();
      for (const c of [a, b]) await c.curve.connect(fx.trader).buy(E("1"), 0, fx.trader.address, { value: E("1") });
      await fx.launcher.collectMany([await a.token.getAddress(), fx.carol.address, await b.token.getAddress()]);
      expect(await fx.launcher.platformFees()).to.equal(E("0.0028"));
    });

    it("collects in full at the gas the node estimates, also for a graduated coin", async () => {
      // The e2e found this on a mainnet fork: with failed collections skipped, gas estimation
      // settled on a limit at which a collection ran dry and was skipped, so a claim right after
      // it paid nothing. A starved collection now fails instead.
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice, { tax: 100 });
      const token = await c.token.getAddress();
      await graduate(fx, c);
      const trader = fx.router.connect(fx.trader);
      const deadline = ethers.MaxUint256;
      await (await trader.buy(token, 0, fx.trader.address, deadline, { value: E("0.3") })).wait();
      const bal = await c.token.balanceOf(fx.trader.address);
      await c.token.connect(fx.trader).approve(await fx.router.getAddress(), bal / 2n);
      await (await trader.sell(token, bal / 2n, 0, fx.trader.address, deadline)).wait();
      expect(await fx.escrow.balanceOf(await c.splitter.getAddress())).to.be.gt(0);
      // No gas limit given: the node estimates it, as a wallet would.
      await (await fx.launcher.connect(fx.bob).collectMany([token])).wait();
      expect(await fx.escrow.balanceOf(await c.splitter.getAddress())).to.equal(0);
      expect(await fx.vault.tokenFees(token)).to.be.gt(0);
    });

    it("fails a collection that runs out of gas instead of skipping it", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice);
      await pastSnipeWindow();
      await c.curve.connect(fx.trader).buy(E("1"), 0, fx.trader.address, { value: E("1") });
      const token = await c.token.getAddress();
      const full = await fx.launcher.collectMany.estimateGas([token]);
      // Below what it needs, wherever it runs dry, the call fails rather than succeed without collecting.
      for (let pct = 99n; pct >= 40n; pct -= 3n) {
        await expect(fx.launcher.collectMany([token], { gasLimit: (full * pct) / 100n }), `${pct}%`).to.be.reverted;
      }
      const alone = await c.splitter.collect.estimateGas();
      for (let pct = 99n; pct >= 40n; pct -= 3n) {
        await expect(c.splitter.collect({ gasLimit: (alone * pct) / 100n }), `alone ${pct}%`).to.be.reverted;
      }
      expect(await fx.vault.tokenFees(token)).to.equal(0);
      await (await fx.launcher.collectMany([token], { gasLimit: full })).wait();
      expect(await fx.vault.tokenFees(token)).to.be.gt(0);
    });

    it("lets only the owner withdraw SplitEarn's share and recover stray tokens", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice, { firstBuy: E("0.1") });
      await pastSnipeWindow();
      await c.curve.connect(fx.trader).buy(E("1"), 0, fx.trader.address, { value: E("1") });
      await c.splitter.collect();
      const owed = await fx.launcher.platformFees();
      await expect(fx.launcher.connect(fx.alice).withdrawPlatformFees(fx.alice.address)).to.be.revertedWithCustomError(fx.launcher, "OwnableUnauthorizedAccount");
      expect(await received(fx.carol, () => fx.launcher.withdrawPlatformFees(fx.carol.address))).to.equal(owed);
      expect(await fx.launcher.platformFees()).to.equal(0);
      expect(owed).to.be.gt(0);

      const splitter = await c.splitter.getAddress();
      await c.token.connect(fx.alice).transfer(splitter, 1000n);
      await expect(c.splitter.connect(fx.alice).recoverToken(await c.token.getAddress(), fx.alice.address)).to.be.revertedWithCustomError(c.splitter, "OnlyOwner");
      await c.splitter.recoverToken(await c.token.getAddress(), fx.carol.address);
      expect(await c.token.balanceOf(fx.carol.address)).to.equal(1000n);
    });

    it("can't be re-initialized or initialized by anyone but the launcher", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice);
      await expect(c.splitter.connect(fx.alice).initialize(fx.alice.address, fx.alice.address, ethers.ZeroHash, 0)).to.be.revertedWithCustomError(c.splitter, "OnlyLauncher");
      const impl = await ethers.getContractAt("FeeSplitter", await fx.launcher.splitterImplementation());
      await expect(impl.collect()).to.be.revertedWithCustomError(impl, "NotInitialized");
    });
  });

  describe("claims", () => {
    it("pays an X account's balance to the wallet the signer approved", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice);
      await pastSnipeWindow();
      await c.curve.connect(fx.trader).buy(E("1"), 0, fx.trader.address, { value: E("1") });
      await c.splitter.collect();
      const owed = await fx.vault.claimable(IDS.bob);
      const deadline = BigInt((await time.latest()) + 600);
      const sig = await signClaim(fx.vault, fx.signer, IDS.bob, fx.carol.address, deadline);
      await expect(fx.vault.connect(fx.alice).claim(IDS.bob, fx.alice.address, deadline, sig)).to.be.revertedWithCustomError(fx.vault, "BadSignature");
      expect(await received(fx.carol, () => fx.vault.connect(fx.alice).claim(IDS.bob, fx.carol.address, deadline, sig))).to.equal(owed);
      await expect(fx.vault.claim(IDS.bob, fx.carol.address, deadline, sig)).to.be.revertedWithCustomError(fx.vault, "BadSignature");
      expect((await fx.vault.earningsOf([IDS.bob]))[1][0]).to.equal(owed);
    });

    it("collects the latest fees and claims them in one transaction", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice);
      await pastSnipeWindow();
      await c.curve.connect(fx.trader).buy(E("1"), 0, fx.trader.address, { value: E("1") });
      // Nothing is claimable yet: the fees still sit on the curve.
      expect(await fx.vault.claimable(IDS.alice)).to.equal(0);
      const deadline = BigInt((await time.latest()) + 600);
      const sig = await signClaim(fx.vault, fx.signer, IDS.alice, fx.carol.address, deadline);
      const token = await c.token.getAddress();
      const got = await received(fx.carol, () =>
        fx.launcher.connect(fx.alice).collectAndClaim([token], IDS.alice, fx.carol.address, deadline, sig)
      );
      expect(got).to.equal((E("0.0056") * 6000n) / BPS);
      expect(await fx.vault.claimable(IDS.alice)).to.equal(0);
    });

    it("pauses claims and rotates the signer", async () => {
      const fx = await loadFixture(deploy);
      const deadline = BigInt((await time.latest()) + 600);
      await fx.vault.setClaimsPaused(true);
      await expect(fx.vault.claim(IDS.bob, fx.bob.address, deadline, "0x")).to.be.revertedWithCustomError(fx.vault, "ClaimsPaused");
      await fx.vault.setClaimsPaused(false);
      await fx.vault.setSigner(fx.carol.address);
      const old = await signClaim(fx.vault, fx.signer, IDS.bob, fx.bob.address, deadline);
      await expect(fx.vault.claim(IDS.bob, fx.bob.address, deadline, old)).to.be.revertedWithCustomError(fx.vault, "BadSignature");
      await expect(fx.vault.connect(fx.alice).setSigner(fx.alice.address)).to.be.revertedWithCustomError(fx.vault, "OwnableUnauthorizedAccount");
    });

    it("only lets approved launchers register splits", async () => {
      const fx = await loadFixture(deploy);
      const s = await split(fx, fx.alice.address);
      await expect(fx.vault.connect(fx.alice).setSplit(fx.alice.address, fx.alice.address, s.xIds, s.handles, s.bps, s.deadline, s.attestation)).to.be.revertedWithCustomError(fx.vault, "OnlyLauncher");
      await expect(fx.vault.connect(fx.alice).setLauncher(fx.alice.address, true)).to.be.revertedWithCustomError(fx.vault, "OwnableUnauthorizedAccount");
      await expect(fx.vault.deposit(fx.alice.address, { value: 1 })).to.be.revertedWithCustomError(fx.vault, "NoSplit");
    });
  });

  describe("router", () => {
    it("trades a graduated coin in its Pons pool, at the price it quotes", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice);
      const token = await c.token.getAddress();
      await expect(fx.router.quote(token, true, E("1"))).to.be.revertedWithCustomError(fx.router, "NotOnPool");
      await graduate(fx, c);

      const quoted = await fx.router.quote.staticCall(token, true, E("0.5"));
      expect(quoted).to.be.gt(0);
      const before = await c.token.balanceOf(fx.bob.address);
      await fx.router.connect(fx.bob).buy(token, quoted, fx.bob.address, ethers.MaxUint256, { value: E("0.5") });
      const got = (await c.token.balanceOf(fx.bob.address)) - before;
      expect(got).to.equal(quoted);

      const sellQuote = await fx.router.quote.staticCall(token, false, got);
      await c.token.connect(fx.bob).approve(await fx.router.getAddress(), got);
      await expect(fx.router.connect(fx.bob).sell(token, got, sellQuote + 1n, fx.bob.address, ethers.MaxUint256)).to.be.revertedWithCustomError(fx.router, "SlippageExceeded");
      expect(await ethDelta(fx.bob, () => fx.router.connect(fx.bob).sell(token, got, sellQuote, fx.bob.address, ethers.MaxUint256))).to.equal(sellQuote);
      // Round trip costs about 2% in Pons fees (plus price impact).
      expect(sellQuote).to.be.lt(E("0.5"));
      expect(sellQuote).to.be.gt(E("0.48"));
    });

    it("reports the pool price and checks deadlines", async () => {
      const fx = await loadFixture(deploy);
      const c = await launch(fx, fx.alice);
      const token = await c.token.getAddress();
      await graduate(fx, c);
      const v = await fx.launcher.getLaunch(token);
      expect(v.phase).to.equal(2);
      expect(v.sqrtPriceX96).to.be.gt(0);
      expect(v.liquidity).to.be.gt(0);
      // The pool opens at the curve's closing price.
      const price = Number(v.sqrtPriceX96) ** 2 / 2 ** 192; // tokens per ETH
      expect(1 / price).to.be.closeTo(5.88 / 285714285.7, 1e-10);
      await expect(fx.router.buy(token, 0, fx.bob.address, 1, { value: 1 })).to.be.revertedWithCustomError(fx.router, "Expired");
      await expect(fx.router.buy(token, 0, fx.bob.address, ethers.MaxUint256)).to.be.revertedWithCustomError(fx.router, "ZeroAmount");
      await expect(fx.router.unlockCallback("0x")).to.be.revertedWithCustomError(fx.router, "NotPoolManager");
    });
  });

  describe("views", () => {
    it("pages coins newest first with their live state", async () => {
      const fx = await loadFixture(deploy);
      const a = await launch(fx, fx.alice);
      const b = await launch(fx, fx.bob, { handles: ["carol"], bps: [10000] });
      await graduate(fx, a);
      const page = await fx.launcher.getLaunches(0, 10);
      expect(page.length).to.equal(2);
      expect(page[0].launch.token).to.equal(await b.token.getAddress());
      expect(page[0].phase).to.equal(0);
      expect(page[0].handles).to.deep.equal(["carol"]);
      expect(page[1].phase).to.equal(2);
      expect(page[1].raised).to.equal(0);
      expect((await fx.launcher.getLaunches(1, 10)).length).to.equal(1);
      expect((await fx.launcher.getLaunches(5, 10)).length).to.equal(0);
      expect(await fx.launcher.launchCount()).to.equal(2);
      expect((await fx.launcher.getLaunch(fx.alice.address)).launch.token).to.equal(ethers.ZeroAddress);
    });
  });
});
