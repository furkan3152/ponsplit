// /setup end to end, as the owner does it from a phone: every contract is deployed from the owner's
// own wallet (testnet: PonsEarn's copy of pons, then PonsEarn; mainnet: PonsEarn on the real pons),
// a double tap still sends each transaction once, and a reload resumes instead of deploying again.
// Writes the addresses to pin to deploy.env.
//
//   NETWORK=testnet|mainnet BASE=http://localhost:3000 RPC=http://127.0.0.1:8545 node setup.mjs
import { writeFileSync } from "fs";
import { ethers } from "ethers";
import { chromium } from "playwright";
import { BASE, NETWORK, OUT, OWNER, errors, fail, openAs, provider, same, step, waitFor } from "./lib.mjs";

const PONS_MAINNET_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";

await waitFor(`${BASE}/api/config`);
const config = await (await fetch(`${BASE}/api/config`)).json();
if (!config.signer) fail("the server has no signing key");

const nonceBefore = await provider.getTransactionCount(OWNER);
const browser = await chromium.launch();
try {
  const page = await openAs(browser, OWNER, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/setup`, { timeout: 180_000 });
  const deploy = page.getByRole("button", { name: /^Deploy \(\d+ transactions\)$/ });
  const connectButton = page.getByRole("button", { name: "Connect wallet" });
  // The injected test wallet may reconnect by itself; otherwise connect it through the modal.
  await deploy.or(connectButton).first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(3000);
  if (!(await deploy.count())) {
    await connectButton.click({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    await page.getByText("E2E Wallet").first().click({ force: true, timeout: 10_000 });
  }
  await deploy.waitFor({ timeout: 90_000 });
  const count = Number(/\((\d+) transactions\)/.exec(await deploy.textContent())[1]);
  const expected = NETWORK === "testnet" ? 19 : 3;
  if (count !== expected) fail(`expected ${expected} steps on ${NETWORK}, the page shows ${count}`);
  // A double tap (easy on a phone) must still send each transaction exactly once.
  await deploy.dblclick();
  await page.getByText("Deployed. Last step: point the site at it").waitFor({ timeout: 300_000 });
  const json = JSON.parse(await page.locator("pre").first().textContent());
  const pinned = json[NETWORK];
  const launcher = ethers.getAddress(pinned.launcher);
  const feeVault = ethers.getAddress(pinned.feeVault);
  const factory = NETWORK === "testnet" ? ethers.getAddress(pinned.ponsFactory) : PONS_MAINNET_FACTORY;
  await page.screenshot({ path: `${OUT}/setup-deployed-${NETWORK}.png`, fullPage: true });

  const sent = (await provider.getTransactionCount(OWNER)) - nonceBefore;
  if (sent !== expected) fail(`expected exactly ${expected} transactions from the owner's wallet, saw ${sent}`);
  const at = (address, ...sigs) => new ethers.Contract(address, sigs, provider);
  const L = at(launcher, "function owner() view returns (address)", "function ponsFactory() view returns (address)");
  const V = at(feeVault, "function owner() view returns (address)", "function signer() view returns (address)", "function isLauncher(address) view returns (bool)");
  if (!same(await L.owner(), OWNER)) fail("the owner doesn't own the launcher");
  if (!same(await V.owner(), OWNER)) fail("the owner doesn't own the FeeVault");
  if (!same(await V.signer(), config.signer)) fail("FeeVault doesn't trust the site's signing key");
  if (!(await V.isLauncher(launcher))) fail("the FeeVault doesn't accept the launcher");
  if (!same(await L.ponsFactory(), factory)) fail("the launcher isn't on the expected pons factory");
  if (NETWORK === "testnet") {
    const F = at(
      factory,
      "function owner() view returns (address)",
      "function launchEnabled() view returns (bool)",
      "function snipeTaxSeconds() view returns (uint256)",
      "function memeHook() view returns (address)"
    );
    if (!same(await F.owner(), OWNER)) fail("the owner doesn't own the pons copy");
    if (!(await F.launchEnabled())) fail("the pons copy isn't open for launches");
    if ((await F.snipeTaxSeconds()) !== 3n) fail("the pons copy's snipe tax window isn't pons's 3 seconds");
    const hook = await F.memeHook();
    if ((BigInt(hook) & 0x3fffn) !== 0x2044n) fail(`the hook ${hook} doesn't carry its Uniswap v4 permission bits`);
  }
  step(`${NETWORK}: /setup deployed ${expected} steps from ${OWNER}: launcher ${launcher}, FeeVault ${feeVault}, pons factory ${factory}`);

  // A reload finds everything on-chain and offers nothing more to send.
  await page.reload();
  await page.getByText("Deployed. Last step: point the site at it").waitFor({ timeout: 90_000 });
  if (await page.getByRole("button", { name: /^Deploy \(|^Continue \(/ }).count()) fail("a reload offered to deploy again");
  step("a reload resumes from the chain instead of deploying again");
  if (errors.length) fail(`page errors: ${errors.join("; ")}`);

  const NET = NETWORK.toUpperCase();
  writeFileSync(
    "deploy.env",
    [`NEXT_PUBLIC_${NET}_LAUNCHER_ADDRESS=${launcher}`, `NEXT_PUBLIC_${NET}_FEE_VAULT_ADDRESS=${feeVault}`]
      .concat(NETWORK === "testnet" ? [`NEXT_PUBLIC_TESTNET_PONS_FACTORY=${factory}`] : [])
      .join("\n") + "\n"
  );
} finally {
  await browser.close();
}
console.log(`\nSETUP (${NETWORK}) PASSED`);
