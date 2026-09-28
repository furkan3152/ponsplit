// The whole site on a fork of a Robinhood network, with SplitEarn deployed through /setup and pinned
// (setup.mjs): launch a coin on pons with real X accounts, several wallets trade on the pons curve,
// the curve sells out and the pool is opened from the coin page, trading continues on Uniswap v4,
// the claim page reads the accounts' balances, the owner's switches work, and every page renders on
// desktop, mobile and in the light theme without overflowing. Nothing here is mocked: the X
// accounts are real (looked up through the site), and so are pons (mainnet) or SplitEarn's copy of
// it (testnet) and Uniswap v4.
//
//   NETWORK=testnet|mainnet BASE=http://localhost:3000 RPC=http://127.0.0.1:8545 node full.mjs
import { ethers } from "ethers";
import { chromium } from "playwright";
import { A, B, BASE, C, NETWORK, OUT, OWNER, WHALE, connect, errors, fail, openAs, provider, results, same, step, waitFor } from "./lib.mjs";

const NET = NETWORK.toUpperCase();
const LAUNCHER = ethers.getAddress(process.env[`NEXT_PUBLIC_${NET}_LAUNCHER_ADDRESS`] ?? "");
const FEE_VAULT = ethers.getAddress(process.env[`NEXT_PUBLIC_${NET}_FEE_VAULT_ADDRESS`] ?? "");
/** Real X accounts with long-known ids. */
const HANDLES = ["jack", "x"];
const IDS = [12n, 783214n];

const launcher = new ethers.Contract(
  LAUNCHER,
  [
    "function ponsFactory() view returns (address)",
    "function launchCount() view returns (uint256)",
    "function launchOf(address) view returns ((address token,address curve,address splitter,address creator,uint64 createdAt,uint64 createdBlock,uint16 creatorTaxBps,uint16 platformBps,bytes32 poolId))",
    "function launchesPaused() view returns (bool)",
    "function platformFees() view returns (uint256)",
    "function collectMany(address[]) returns (uint256)",
  ],
  provider
);
const vault = new ethers.Contract(
  FEE_VAULT,
  ["function claimable(uint64) view returns (uint256)", "function tokenFees(address) view returns (uint256)"],
  provider
);
const factoryAbi = [
  "function getLaunchedToken(address) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))",
];
const curveAbi = ["function buy(uint256,uint256,address) payable returns (uint256)", "function sellableTokens() view returns (uint256)"];

async function trade(page, side, amountOrPreset, symbol) {
  if (side === "sell") {
    await page.getByRole("button", { name: "sell", exact: true }).click();
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: amountOrPreset, exact: true }).click();
  } else {
    await page.getByRole("button", { name: "buy", exact: true }).click();
    await page.getByLabel("ETH amount").fill(amountOrPreset);
  }
  await page.waitForTimeout(2000);
  const label = side === "buy" ? `Buy ${symbol}` : new RegExp(`^(Approve and sell|Sell) ${symbol}$`);
  await page.getByRole("button", { name: label }).click({ timeout: 30_000 });
  const done = page.getByText(side === "buy" ? /^Bought / : /^Sold for /);
  await done.waitFor({ timeout: 90_000 });
  return done.textContent();
}

await waitFor(`${BASE}/api/config`);
const browser = await chromium.launch();
try {
  const factory = new ethers.Contract(await launcher.ponsFactory(), factoryAbi, provider);

  // ── 1. Real X accounts resolve through the site ─────────────────────────────────────────
  const resolved = await (await fetch(`${BASE}/api/x/resolve?handles=${HANDLES.join(",")}`)).json();
  HANDLES.forEach((h, i) => {
    if (resolved.profiles?.[h]?.id !== IDS[i].toString()) fail(`@${h} resolved to ${JSON.stringify(resolved.profiles?.[h])}`);
  });
  step(`real X accounts resolve: ${HANDLES.map((h, i) => `@${h} → ${IDS[i]}`).join(", ")}`);

  // ── 2. The owner's switches on /setup ───────────────────────────────────────────────────
  const owner = await openAs(browser, OWNER, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await owner.goto(`${BASE}/setup`, { timeout: 180_000 });
  await owner.getByText(`SplitEarn is live on ${NETWORK}`).waitFor({ timeout: 90_000 });
  await connect(owner);
  await owner.getByRole("button", { name: "Pause launches" }).click({ timeout: 60_000 });
  await owner.getByRole("button", { name: "Resume launches" }).waitFor({ timeout: 60_000 });
  if (!(await launcher.launchesPaused())) fail("pausing launches on /setup didn't reach the chain");
  await owner.getByRole("button", { name: "Resume launches" }).click();
  await owner.getByRole("button", { name: "Pause launches" }).waitFor({ timeout: 60_000 });
  if (await launcher.launchesPaused()) fail("resuming launches on /setup didn't reach the chain");
  step("the owner pauses and resumes launches from /setup on a phone");

  // ── 3. Launch through the UI: a 1% creator tax and a first buy ──────────────────────────
  const creator = await openAs(browser, A);
  await creator.goto(`${BASE}/create`, { timeout: 180_000 });
  await connect(creator);
  await creator.getByLabel("Name").fill("E2E Split Coin");
  await creator.getByLabel("Ticker").fill("SPLIT");
  await creator.getByLabel("Description").fill(`Launched by the end-to-end test on a Robinhood Chain ${NETWORK} fork.`);
  await creator.getByLabel("X account 1").fill("@jack");
  await creator.getByLabel("X account 2").fill("x.com/x");
  await creator.getByLabel("Share 1").fill("60");
  await creator.getByLabel("Share 2").fill("40");
  await creator.getByRole("radio", { name: "1%" }).click();
  await creator.getByLabel("Be the first buyer").fill("0.05");
  await creator.getByText(/^✓ /).first().waitFor({ timeout: 60_000 });
  await creator.getByRole("button", { name: "Launch coin" }).click({ timeout: 60_000 });
  // The coin page drops ?launched=1 from the URL right after it opens, so match the page itself.
  await creator.waitForURL(/\/token\/0x[0-9a-fA-F]{40}/, { timeout: 120_000 });
  const tokenUrl = creator.url().split("?")[0];
  const token = ethers.getAddress(tokenUrl.split("/token/")[1]);
  await creator.getByText("$SPLIT is live.").waitFor({ timeout: 30_000 });
  const l = await launcher.launchOf(token);
  if (!same(l.creator, A) || Number(l.creatorTaxBps) !== 100) fail(`unexpected launch record ${l}`);
  const rec = await factory.getLaunchedToken(token);
  if (!same(rec.deployer, LAUNCHER) || !same(rec.creatorFeeRecipient, l.splitter) || Number(rec.creatorTaxBps) !== 100) fail("pons's record doesn't match the launch");
  const erc20 = new ethers.Contract(token, ["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"], provider);
  if ((await erc20.balanceOf(A)) === 0n) fail("the first buy didn't reach the creator");
  if ((await erc20.totalSupply()) !== ethers.parseEther("1000000000")) fail("the coin isn't a 1B-supply pons coin");
  step(`launched $SPLIT on ${NETWORK === "mainnet" ? "pons" : "SplitEarn's pons copy"} through the UI → ${token} (1% tax, first buy)`);
  await creator.screenshot({ path: `${OUT}/01-launched-${NETWORK}.png`, fullPage: true });

  // ── 4. Several wallets trade on the curve through the UI ─────────────────────────────────
  const traders = [];
  for (const [i, acct] of [B, C].entries()) {
    const p = await openAs(browser, acct);
    await p.goto(tokenUrl, { timeout: 180_000 });
    await connect(p);
    step(`wallet ${acct.slice(0, 8)} ${await trade(p, "buy", ["0.3", "0.2"][i], "SPLIT")} on the curve`);
    traders.push(p);
  }
  step(`wallet ${B.slice(0, 8)} ${await trade(traders[0], "sell", "50%", "SPLIT")} on the curve (approve + sell)`);
  await traders[1].getByText("Live tape").waitFor();
  await traders[1].getByRole("row").filter({ hasText: /Sell/ }).first().waitFor({ timeout: 60_000 });
  step("the trades show up on the coin page's tape");

  // ── 5. The curve sells out; the pool is opened from the coin page ────────────────────────
  const curve = new ethers.Contract(l.curve, curveAbi, await provider.getSigner(WHALE));
  await (await curve.buy(ethers.parseEther("6"), 1n, WHALE, { value: ethers.parseEther("6") })).wait();
  const phase = Number((await factory.getLaunchedToken(token)).phase);
  if (phase !== 1 && phase !== 2) fail(`expected the crossing buy to graduate the coin, phase ${phase}`);
  step(`a whale bought the curve out → pons phase ${phase}`);
  const opener = traders[1];
  await opener.goto(tokenUrl);
  if (phase === 1) {
    await opener.getByRole("button", { name: "Create the pool" }).click({ timeout: 60_000 });
    await opener.getByText("The pool is live. Trading continues here.").waitFor({ timeout: 90_000 });
    if (Number((await factory.getLaunchedToken(token)).phase) !== 2) fail("the pool wasn't created");
    step("the coin page opened its Uniswap v4 pool (pons's createGraduatedPool)");
  }
  await opener.reload();
  await opener.getByText("Trading in the pons Uniswap v4 pool").waitFor({ timeout: 60_000 });
  step(`pool trade: ${await trade(opener, "buy", "0.1", "SPLIT")}`);
  step(`pool trade: ${await trade(opener, "sell", "25%", "SPLIT")} (approve + sell)`);
  await opener.waitForTimeout(3000);
  await opener.screenshot({ path: `${OUT}/02-graduated-${NETWORK}.png`, fullPage: true });

  // ── 6. Fees: collected into the vault; the owner withdraws SplitEarn's share ───────────────
  await (await launcher.connect(await provider.getSigner(WHALE)).collectMany([token])).wait();
  const split = await vault.tokenFees(token);
  const jack = await vault.claimable(IDS[0]);
  const x = await vault.claimable(IDS[1]);
  if (split === 0n || jack === 0n || x === 0n) fail(`fees didn't reach the X accounts: split ${split}, @jack ${jack}, @x ${x}`);
  const platform = await launcher.platformFees();
  if (platform === 0n) fail("SplitEarn's share didn't arrive");
  step(`fees split: ${ethers.formatEther(split)} ETH to the X accounts (@jack ${ethers.formatEther(jack)}, @x ${ethers.formatEther(x)}), ${ethers.formatEther(platform)} ETH to SplitEarn`);
  await owner.goto(`${BASE}/setup`);
  await owner.getByRole("button", { name: "Withdraw to this wallet" }).click({ timeout: 60_000 });
  await owner.getByText("Withdraw to this wallet: done.").waitFor({ timeout: 60_000 });
  if ((await launcher.platformFees()) !== 0n) fail("the withdrawal didn't reach the chain");
  step("the owner withdrew SplitEarn's share from /setup");

  // ── 7. The claim page reads an account's vault and makes its proof post ───────────────────
  const claimer = traders[0];
  await claimer.goto(`${BASE}/claim`);
  await connect(claimer);
  await claimer.getByLabel("Your X username").fill("@jack");
  await claimer.getByText("Ready to claim").waitFor({ timeout: 60_000 });
  await claimer.getByRole("button", { name: "Create my proof post" }).click({ timeout: 60_000 });
  await claimer.getByText(/PE-[0-9A-F]+/).first().waitFor({ timeout: 30_000 });
  await claimer.screenshot({ path: `${OUT}/03-claim-${NETWORK}.png`, fullPage: true });
  step("the claim page shows @jack's balance and a proof post for the connected wallet");

  // ── 8. The network switch at the top reloads the site on the other network ────────────────
  const other = NETWORK === "testnet" ? "mainnet" : "testnet";
  await claimer.goto(`${BASE}/`);
  await claimer.getByRole("radio", { name: other === "testnet" ? /Test/ : /Main/ }).click();
  await claimer.getByText(`SplitEarn isn't live on ${other} yet.`).waitFor({ timeout: 60_000 });
  const cookie = (await claimer.context().cookies()).find((c) => c.name === "pe-network");
  if (cookie?.value !== other) fail(`the switch left the network cookie at ${cookie?.value}`);
  step(`the header switch moves the whole site to ${other}`);

  // ── 9. Every page on desktop, mobile and in the light theme ──────────────────────────────
  const pages = ["/", "/create", tokenUrl.replace(BASE, ""), "/claim", "/me", "/how", "/setup", "/does-not-exist"];
  for (const [label, opts] of [
    ["desktop", { viewport: { width: 1280, height: 900 } }],
    ["mobile", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
    ["light", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, theme: "light" }],
  ]) {
    const p = await openAs(browser, B, opts);
    for (const path of pages) {
      await p.goto(`${BASE}${path}`, { timeout: 120_000 });
      await p.waitForTimeout(1500);
      const name = path === "/" ? "home" : path.split("/").filter(Boolean)[0];
      // Measure before and after the page settles (wallet auto-connect, data loads): late content
      // can be what overflows. Compare with the configured width: in mobile emulation an
      // overflowing page widens innerWidth to fit.
      const measure = () => p.evaluate((w) => document.documentElement.scrollWidth - w, opts.viewport.width);
      const before = await measure();
      await p.waitForTimeout(2500);
      await p.screenshot({ path: `${OUT}/page-${label}-${name}.png`, fullPage: true });
      const overflow = Math.max(before, await measure());
      if (overflow > 0) fail(`${label} ${path}: horizontal overflow ${overflow}px`);
    }
    step(`${label}: ${pages.length} pages render without horizontal overflow`);
  }

  if (errors.length) fail(`page errors:\n${errors.join("\n")}`);
  step("no page errors");
  console.log(`\nE2E (${NETWORK}) PASSED (${results.length} checks)`);
} catch (e) {
  console.error(`E2E (${NETWORK}) FAILED:`, e.message);
  if (errors.length) console.error("page errors:", errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
