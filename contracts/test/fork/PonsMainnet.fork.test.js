// Runs PonsEarn on a fork of a Robinhood Chain network. Needs network access, so it only runs with
// FORK_URL set:
//   FORK_URL=https://rpc.mainnet.chain.robinhood.com npx hardhat test test/fork/PonsMainnet.fork.test.js
//     → against the real Pons v2 and Uniswap v4 on mainnet;
//   FORK_NETWORK=testnet FORK_URL=https://rpc.testnet.chain.robinhood.com npx hardhat test test/fork/...
//     → deploys PonsEarn's own copy of Pons v2 on testnet (as /setup does) against the testnet's Uniswap v4.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployPonsCopy, vendor } = require("../../scripts/lib/pons-stack");
const verified = require("../../vendor/verified.json");

const FORK_NETWORK = process.env.FORK_NETWORK || "mainnet";

const E = ethers.parseEther;
const BPS = 10_000n;
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const SOCIALS = { twitter: "", telegram: "", discord: "", website: "", farcaster: "" };

const factoryAbi = [
  "function launchEnabled() view returns (bool)",
  "function owner() view returns (address)",
  "function setLaunchEnabled(bool)",
  "function launchFee() view returns (uint256)",
  "function previewLaunchEconomics(uint256,address) view returns (bytes32)",
  "function createGraduatedPool(address) returns (uint256)",
  "function snipeTaxSeconds() view returns (uint256)",
  "function memeHook() view returns (address)",
  "function feeEscrow() view returns (address)",
  "function poolManager() view returns (address)",
  "function getLaunchedToken(address) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))",
];
const curveAbi = [
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256)",
  "function getReserves() view returns (uint256, uint256)",
  "function sellableTokens() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function currentSnipeTaxBps(address) view returns (uint256)",
  "function quoteFeeBalance() view returns (uint256)",
  "function creatorTaxBalance() view returns (uint256)",
  "function graduated() view returns (bool)",
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
];
const hookAbi = [
  "function feeSweepOperator() view returns (address)",
  "function pendingFees(bytes32,address) view returns (uint256)",
  "function pendingCreatorTax(bytes32,address) view returns (uint256)",
  "function sweepPoolFees(bytes32,uint256,uint256)",
];
const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function totalSupply() view returns (uint256)",
];
const escrowAbi = ["function balanceOf(address) view returns (uint256)"];
const poolManagerAbi = [
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
];

// The Pons v2 docs' quote arithmetic ("Getting a quote"), in the curve's own integer order.
const amountOut = (a, rIn, rOut) => (a * rOut) / (rIn + a);
const amountIn = (o, rIn, rOut) => (o * rIn) / (rOut - o) + 1n;
const ceilDiv = (a, b) => (a + b - 1n) / b;
async function quoteBuy(curve, quoteIn, recipient) {
  const [[qR, tR], sellable, feeBps, taxBps, raw] = await Promise.all([
    curve.getReserves(),
    curve.sellableTokens(),
    curve.feeBps(),
    curve.creatorTaxBps(),
    curve.currentSnipeTaxBps(recipient),
  ]);
  let snipe = raw;
  if (snipe > 0n && snipe > BPS - feeBps - taxBps - 100n) snipe = BPS - feeBps - taxBps - 100n;
  let spent = quoteIn;
  const fee = (spent * feeBps) / BPS;
  const tax = (spent * taxBps) / BPS;
  const snipeTax = (spent * snipe) / BPS;
  let tokensOut = amountOut(spent - fee - tax - snipeTax, qR, tR);
  if (tokensOut > sellable) {
    tokensOut = sellable;
    const grossed = ceilDiv(amountIn(sellable, qR, tR) * BPS, BPS - feeBps - taxBps - snipe);
    spent = grossed < quoteIn ? grossed : quoteIn;
  }
  return { tokensOut, spent };
}
async function quoteSell(curve, tokensIn) {
  const [[qR, tR], feeBps, taxBps] = await Promise.all([curve.getReserves(), curve.feeBps(), curve.creatorTaxBps()]);
  const gross = amountOut(tokensIn, tR, qR);
  return gross - (gross * feeBps) / BPS - (gross * taxBps) / BPS;
}

async function impersonate(address) {
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  await network.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
  return ethers.getSigner(address);
}

const FORK = Boolean(process.env.FORK_URL);

/** Runtime code equality with the immutable values (set per deployment) blanked out. */
function sameCode(onchain, artifact) {
  const blank = (hex) => {
    const bytes = Buffer.from(hex.slice(2), "hex");
    for (const refs of Object.values(artifact.immutableReferences || {})) for (const r of refs) bytes.fill(0, r.start, r.start + r.length);
    return bytes.toString("hex");
  };
  return blank(onchain) === blank(artifact.deployedBytecode);
}

(FORK ? describe : describe.skip)(`PonsEarn on a Robinhood Chain ${FORK_NETWORK} fork`, function () {
  this.timeout(600_000);
  let owner, signer, alice, trader, whale, vault, launcher, router, pons, hook, escrow;
  let token, curve, splitter, coin, poolId;

  const domain = async () => ({
    name: "PonsEarn FeeVault",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await vault.getAddress(),
  });

  let ponsFactory = PONS_FACTORY;

  before(async () => {
    const accounts = await ethers.getSigners();
    [owner, signer, alice, trader, whale] = accounts;
    // Hardhat's well-known test accounts carry EIP-7702 delegations on Robinhood Chain (sweeper
    // bots set them), so they reject plain ETH transfers. On the fork they are plain accounts again.
    for (const a of accounts.slice(0, 5)) {
      if ((await ethers.provider.getCode(a.address)) !== "0x") await network.provider.send("hardhat_setCode", [a.address, "0x"]);
    }
    // Arbitrum block headers have no blob-gas fields, and EDR cannot run calls against the fork
    // block itself without them; every call runs on local blocks from here on.
    await network.provider.send("evm_mine");
    if (FORK_NETWORK === "testnet") {
      // Pons has no testnet deployment: this is PonsEarn's copy, deployed the way /setup does.
      ponsFactory = (await deployPonsCopy(owner)).factory;
      console.log(`      Pons copy deployed on the testnet fork: factory ${ponsFactory}`);
    }
    pons = await ethers.getContractAt(factoryAbi, ponsFactory);
    // Pons can close launches for everyone but whitelisted launchers. These tests are about
    // PonsEarn, not Pons's uptime, so a closed gate is reopened on the fork (and reported).
    if (!(await pons.launchEnabled())) {
      console.log("      (Pons launches are closed on mainnet right now; reopened on the fork)");
      await pons.connect(await impersonate(await pons.owner())).setLaunchEnabled(true);
    }
    vault = await ethers.deployContract("FeeVault", [owner.address, signer.address]);
    launcher = await ethers.deployContract("PonsEarnLauncher", [owner.address, await vault.getAddress(), ponsFactory]);
    await vault.setLauncher(await launcher.getAddress(), true);
    router = await ethers.getContractAt("PonsEarnRouter", await launcher.router());
    hook = await ethers.getContractAt(hookAbi, await pons.memeHook());
    escrow = await ethers.getContractAt(escrowAbi, await pons.feeEscrow());
  });

  (FORK_NETWORK === "mainnet" ? it : it.skip)("vendors exactly the Pons v2 code deployed on mainnet", async () => {
    // contracts/vendor is compiled from Blockscout's verified sources; the testnet copy is deployed
    // from those artifacts, so they must be byte for byte what runs on mainnet.
    for (const name of ["PonsV2LaunchFactory", "PonsV2MemeHook", "PonsV2FeeEscrow", "PonsV2BuybackVault", "PonsV2LaunchLocker", "PonsV2LaunchDeployer", "PonsV2GraduationExecutor", "PonsV2GraduationGuard"]) {
      const code = await ethers.provider.getCode(verified[name].address);
      expect(sameCode(code, vendor(name)), name).to.equal(true);
    }
  });

  it("reads Pons's live launch terms", async () => {
    const t = await launcher.launchTerms();
    expect(t.canLaunch).to.equal(true);
    expect(t.ponsLaunchFee).to.equal(await pons.launchFee());
    expect(t.economics).to.equal(await pons.previewLaunchEconomics(0, ethers.ZeroAddress));
    console.log(`      Pons launch fee ${ethers.formatEther(t.ponsLaunchFee)} ETH, max creator tax ${t.maxCreatorTaxBps} bps`);
  });

  it("launches a coin on Pons with a first buy, free of the snipe tax", async () => {
    const xIds = [111n, 222n];
    const handles = ["alpha", "beta"];
    const deadline = BigInt((await time.latest()) + 3600);
    const attestation = await signer.signTypedData(
      await domain(),
      {
        SplitAttestation: [
          { name: "creator", type: "address" },
          { name: "xIds", type: "uint64[]" },
          { name: "handles", type: "string[]" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { creator: alice.address, xIds, handles, deadline }
    );
    const terms = await launcher.launchTerms();
    const firstBuy = E("0.1");
    const tx = await launcher.connect(alice).launch(
      {
        name: "PonsEarn Fork",
        symbol: "PEFORK",
        logo: "ipfs://bafkreiaaaa",
        description: "fork test",
        socials: { ...SOCIALS, twitter: "https://x.com/alpha" },
        creatorTaxBps: 100,
        salt: ethers.id("ponsearn-fork"),
        expectedEconomics: terms.economics,
      },
      { xIds, handles, bps: [7000, 3000], deadline, attestation },
      firstBuy,
      1n,
      terms.version,
      { value: terms.ponsLaunchFee + firstBuy }
    );
    const receipt = await tx.wait();
    console.log(`      launch + first buy gas: ${receipt.gasUsed}`);
    const ev = receipt.logs.map((l) => launcher.interface.parseLog(l)).find((l) => l?.name === "Launched");
    token = ev.args.token;
    curve = await ethers.getContractAt(curveAbi, ev.args.curve);
    splitter = await ethers.getContractAt("FeeSplitter", ev.args.splitter);
    coin = await ethers.getContractAt(erc20Abi, token);

    const rec = await pons.getLaunchedToken(token);
    expect(rec.deployer).to.equal(await launcher.getAddress());
    expect(rec.creatorFeeRecipient).to.equal(await splitter.getAddress());
    expect(rec.buybackEnabled).to.equal(false);
    expect(rec.creatorTaxBps).to.equal(100);
    expect(rec.phase).to.equal(0);
    // 14 bps of volume out of 70 + 100 bps.
    expect(await splitter.platformBps()).to.equal((2000n * 700_000n) / (700_000n + 1_000_000n));

    // Untaxed first buy: 0.1 ETH less 1% fee and 1% tax, priced on the fresh curve.
    const bought = await coin.balanceOf(alice.address);
    expect(bought).to.equal(ev.args.tokensOut);
    const [qR] = await curve.getReserves();
    expect(bought).to.be.gt(0);
    expect(await curve.currentSnipeTaxBps(alice.address)).to.equal(0);
    console.log(`      first buy: ${ethers.formatEther(bought)} tokens; curve quote reserve now ${ethers.formatEther(qR)} ETH`);
  });

  it("matches the Pons docs' quote arithmetic for buys and sells", async () => {
    await time.increase(Number(await pons.snipeTaxSeconds()) + 2);
    const q = await quoteBuy(curve, E("0.5"), trader.address);
    const before = await coin.balanceOf(trader.address);
    await curve.connect(trader).buy(E("0.5"), q.tokensOut, trader.address, { value: E("0.5") });
    const got = (await coin.balanceOf(trader.address)) - before;
    expect(got).to.equal(q.tokensOut);

    const sellAmount = got / 3n;
    const expectedEth = await quoteSell(curve, sellAmount);
    await coin.connect(trader).approve(await curve.getAddress(), sellAmount);
    const ethBefore = await ethers.provider.getBalance(trader.address);
    const r = await (await curve.connect(trader).sell(sellAmount, expectedEth, trader.address)).wait();
    const ethGot = (await ethers.provider.getBalance(trader.address)) - ethBefore + r.gasUsed * r.gasPrice;
    expect(ethGot).to.equal(expectedEth);
  });

  it("collects curve fees and splits them: PonsEarn's share and the X accounts'", async () => {
    const fees = await curve.quoteFeeBalance();
    const tax = await curve.creatorTaxBalance();
    const pending = await splitter.pendingFees();
    expect(pending).to.equal(fees - (fees * 3000n) / BPS + tax + (await escrow.balanceOf(await splitter.getAddress())));
    await (await splitter.collect()).wait();
    expect(await curve.quoteFeeBalance()).to.equal(0);
    const platform = (pending * (await splitter.platformBps())) / BPS;
    expect(await launcher.platformFees()).to.equal(platform);
    expect(await vault.tokenFees(token)).to.equal(pending - platform);
    expect(await vault.claimable(111n)).to.equal(((pending - platform) * 7000n) / BPS);
    console.log(`      split ${ethers.formatEther(pending)} ETH: ${ethers.formatEther(platform)} to PonsEarn`);
  });

  it("graduates the Pons way: the curve sells out, then the v4 pool is created", async () => {
    const r = await (await curve.connect(whale).buy(E("10"), 1n, whale.address, { value: E("10") })).wait();
    console.log(`      crossing buy gas: ${r.gasUsed}`);
    let rec = await pons.getLaunchedToken(token);
    console.log(`      phase after the crossing buy: ${rec.phase}`);
    expect(await curve.graduated()).to.equal(true);
    if (Number(rec.phase) === 1) {
      const g = await (await pons.createGraduatedPool(token)).wait();
      console.log(`      createGraduatedPool gas: ${g.gasUsed}`);
      const pm = new ethers.Interface(poolManagerAbi);
      const init = g.logs.map((l) => { try { return pm.parseLog(l); } catch { return null; } }).find((l) => l?.name === "Initialize");
      poolId = (await launcher.launchOf(token)).poolId;
      expect(init.args.id).to.equal(poolId);
      rec = await pons.getLaunchedToken(token);
    }
    expect(rec.phase).to.equal(2);
    poolId = (await launcher.launchOf(token)).poolId;
    const v = await launcher.getLaunch(token);
    expect(v.phase).to.equal(2);
    expect(v.sqrtPriceX96).to.be.gt(0);
    const price = 1 / (Number(v.sqrtPriceX96) ** 2 / 2 ** 192);
    console.log(`      pool price ${price.toExponential(4)} ETH per token, liquidity ${v.liquidity}`);
    // Graduation swept the curve's remaining fees to the escrow.
    expect(await escrow.balanceOf(await splitter.getAddress())).to.be.gt(0);
  });

  it("trades on the Uniswap v4 pool through the router at exactly the quoted amounts", async () => {
    const q = await router.quote.staticCall(token, true, E("0.3"));
    const before = await coin.balanceOf(trader.address);
    const r = await (await router.connect(trader).buy(token, q, trader.address, ethers.MaxUint256, { value: E("0.3") })).wait();
    console.log(`      router buy gas: ${r.gasUsed}`);
    expect((await coin.balanceOf(trader.address)) - before).to.equal(q);

    // The pool price the launcher reports is the one the swap left behind.
    const pm = new ethers.Interface(poolManagerAbi);
    const swap = r.logs.map((l) => { try { return pm.parseLog(l); } catch { return null; } }).find((l) => l?.name === "Swap");
    expect(swap.args.id).to.equal(poolId);
    expect((await launcher.getLaunch(token)).sqrtPriceX96).to.equal(swap.args.sqrtPriceX96);

    const bal = await coin.balanceOf(trader.address);
    const sq = await router.quote.staticCall(token, false, bal / 2n);
    await coin.connect(trader).approve(await router.getAddress(), bal / 2n);
    const ethBefore = await ethers.provider.getBalance(trader.address);
    const s = await (await router.connect(trader).sell(token, bal / 2n, sq, trader.address, ethers.MaxUint256)).wait();
    expect((await ethers.provider.getBalance(trader.address)) - ethBefore + s.gasUsed * s.gasPrice).to.equal(sq);
  });

  it("keeps paying the X accounts after graduation", async () => {
    const before = await vault.tokenFees(token);
    // The buy above left coin-denominated fees that only Pons's keeper may convert; collect must
    // still pay out what the escrow holds without reverting.
    await (await splitter.collect()).wait();
    const afterEscrow = await vault.tokenFees(token);
    expect(afterEscrow).to.be.gt(before);
    const operator = await impersonate(await hook.feeSweepOperator());
    await (await hook.connect(operator).sweepPoolFees(poolId, 1n, 0n)).wait();
    expect(await hook.pendingFees(poolId, token)).to.equal(0);
    await (await splitter.collect()).wait();
    expect(await vault.tokenFees(token)).to.be.gt(afterEscrow);

    // With only ETH-side fees pending, the splitter sweeps the pool itself.
    const bal = await coin.balanceOf(trader.address);
    await coin.connect(trader).approve(await router.getAddress(), bal);
    await router.connect(trader).sell(token, bal, 0, trader.address, ethers.MaxUint256);
    const pending = await splitter.pendingFees();
    const vaultBefore = await vault.tokenFees(token);
    await (await splitter.collect()).wait();
    expect(await hook.pendingFees(poolId, ethers.ZeroAddress)).to.equal(0);
    expect(await vault.tokenFees(token)).to.equal(vaultBefore + pending - (pending * (await splitter.platformBps())) / BPS);
  });

  it("serves a page of coins in one call", async () => {
    const gas = await ethers.provider.estimateGas({
      to: await launcher.getAddress(),
      data: launcher.interface.encodeFunctionData("getLaunches", [0, 50]),
    });
    console.log(`      getLaunches(0, 50) gas with one coin: ${gas}`);
    const page = await launcher.getLaunches(0, 50);
    expect(page[0].launch.token).to.equal(token);
    expect(page[0].name).to.equal("PonsEarn Fork");
    expect(page[0].handles).to.deep.equal(["alpha", "beta"]);
  });
});
