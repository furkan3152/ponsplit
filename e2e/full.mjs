// Full-stack end-to-end test: the real web app, a real browser, several wallets, against a chain
// node (in CI: a fork of Robinhood Chain testnet). Covers setup → ownership → launch → multi-wallet
// trading → graduation → pool trading → proof claim → every page on desktop, mobile and dark mode.
//
// Env:
//   BASE        web app in mock X mode (default http://localhost:3000)
//   REAL_BASE   optional second instance using the real X resolver, to check real username → id
//   RPC         chain node with unlocked Hardhat accounts (default http://127.0.0.1:8545)
//   OWNER       OWNER_ADDRESS the app was started with (default Hardhat #4)
//   OUT         screenshot directory (default ./shots)
import { mkdirSync } from "fs";
import { ethers } from "ethers";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3000";
const REAL_BASE = process.env.REAL_BASE;
const RPC = process.env.RPC || "http://127.0.0.1:8545";
const OUT = process.env.OUT || "./shots";
mkdirSync(OUT, { recursive: true });

const provider = new ethers.JsonRpcProvider(RPC);
const accounts = await provider.send("eth_accounts", []);
const [OWNER, A, B, C, WHALE] = [process.env.OWNER || accounts[4], accounts[5], accounts[6], accounts[7], accounts[8]].map((a) => ethers.getAddress(a));

const results = [];
const step = (m) => {
  results.push(m);
  console.log("✔", m);
};
const errors = [];

async function waitFor(url, ms = 180_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`timed out waiting for ${url}`);
}

/** EIP-1193/6963 wallet backed by an unlocked node account. */
const walletScript = (account) => `(() => {
  let id = 0;
  const rpc = async (method, params) => {
    const r = await fetch(${JSON.stringify(RPC)}, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params || [] }) });
    const j = await r.json();
    if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
    return j.result;
  };
  const eth = {
    request: async ({ method, params }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [${JSON.stringify(account)}];
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      if (method === "wallet_requestPermissions" || method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
      return rpc(method, params);
    },
    on: () => {}, removeListener: () => {},
  };
  window.ethereum = eth;
  const info = { uuid: "e2e-wallet", name: "E2E Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "com.example.e2e" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider: eth }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;

async function openAs(browser, account, { theme, ...opts } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  // The site's theme is <html data-theme> from localStorage (dark by default), not the OS setting.
  if (theme) await ctx.addInitScript((t) => localStorage.setItem("ponsplit:theme", t), theme);
  await ctx.addInitScript(walletScript(account));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${account.slice(0, 8)}: ${e.message}`));
  return page;
}

async function connect(page) {
  await page.waitForTimeout(2500);
  const short = new RegExp(page.__account?.slice(0, 4) || "0x", "i");
  if (await page.locator("header").getByText(/0x[0-9a-f]{2}/i).count()) return;
  await page.getByRole("button", { name: "Connect" }).first().click({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.getByText("E2E Wallet").first().click({ force: true, timeout: 5000 }).catch(() => {});
  await page.locator("header").getByText(/0x[0-9a-f]{2}/i).first().waitFor({ timeout: 20_000 });
  void short;
}

async function trade(page, side, amountOrPreset, symbol) {
  if (side === "sell") {
    await page.getByRole("button", { name: "sell", exact: true }).click();
    await page.getByRole("button", { name: amountOrPreset }).click();
  } else {
    await page.getByRole("button", { name: "buy", exact: true }).click();
    await page.getByLabel("ETH amount").fill(amountOrPreset);
  }
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: `${side === "buy" ? "Buy" : "Sell"} ${symbol}` }).click();
  const done = page.getByText(side === "buy" ? /^Bought / : /^Sold for /);
  await done.waitFor({ timeout: 60_000 });
  return done.textContent();
}

await waitFor(`${BASE}/api/config`);
const browser = await chromium.launch();
try {
  // ── 1. Setup: fund the admin, deploy from /setup, hand ownership to OWNER ─────────────
  const status0 = await (await fetch(`${BASE}/api/setup`)).json();
  await provider.send("hardhat_setBalance", [status0.admin, ethers.toQuantity(ethers.parseEther("10"))]);
  const owner = await openAs(browser, OWNER);
  await owner.goto(`${BASE}/setup`, { timeout: 180_000 });
  await owner.getByRole("button", { name: "Deploy contracts" }).click({ timeout: 60_000 });
  await owner.getByText("You're live").waitFor({ timeout: 120_000 });
  step("setup deployed FeeVault + SplitLaunchpad and wired them");
  await connect(owner);
  const propose = owner.getByRole("button", { name: "Propose new owner" });
  if (await propose.count()) await propose.click();
  await owner.getByRole("button", { name: "Accept ownership" }).click({ timeout: 60_000 });
  await owner.getByText(/Owned by/).waitFor({ timeout: 60_000 });
  const status = await (await fetch(`${BASE}/api/setup`)).json();
  if (status.owner !== OWNER || status.vaultOwner !== OWNER) throw new Error("ownership not transferred");
  step(`ownership of both contracts accepted by ${OWNER}`);
  await owner.screenshot({ path: `${OUT}/01-setup.png`, fullPage: true });

  const launchpad = new ethers.Contract(
    status.launchpad,
    [
      "function createToken(string,string,string,(uint64[] xIds,string[] handles,uint16[] bps,uint256 deadline,bytes attestation),uint256,uint256) payable returns (address)",
      "function termsVersion() view returns (uint256)",
      "function getToken(address) view returns ((address token,string name,string symbol,string metadata,(uint256,uint256,uint256,uint256,uint256,address,uint64,uint64,bool,uint16,uint16,uint16) market,uint256 curveSupply,uint256 totalSupply,uint256 creatorFees,uint256 tradeCount,uint64 lastTradeAt,uint64[] xIds,string[] handles,uint16[] bps))",
      "function tokenCount() view returns (uint256)",
      "function allTokens(uint256) view returns (address)",
      "function buy(address,uint256) payable returns (uint256)",
    ],
    await provider.getSigner(WHALE)
  );

  // ── 2. Real X accounts: resolve real usernames and launch with the server's attestation ─
  if (REAL_BASE) {
    await waitFor(`${REAL_BASE}/api/config`);
    const res = await (await fetch(`${REAL_BASE}/api/x/resolve?handles=jack,x`)).json();
    if (res.profiles?.jack?.id !== "12") throw new Error(`real resolver returned ${JSON.stringify(res)}`);
    const att = await (
      await fetch(`${REAL_BASE}/api/attest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creator: WHALE, handles: ["jack", "x"] }) })
    ).json();
    if (!att.attestation) throw new Error(`attest failed: ${JSON.stringify(att)}`);
    const tx = await launchpad.createToken("Real Accounts", "REAL", "{}", { xIds: att.xIds.map(BigInt), handles: att.handles, bps: [5000, 5000], deadline: BigInt(att.deadline), attestation: att.attestation }, 0, await launchpad.termsVersion(), {
      value: ethers.parseEther("0.01"),
    });
    await tx.wait();
    const t = await launchpad.getToken(await launchpad.allTokens((await launchpad.tokenCount()) - 1n));
    step(`real X accounts: @jack → ${t.xIds[0]}, @x → ${t.xIds[1]}; attested launch accepted on-chain`);
  }

  // ── 3. Launch through the UI ───────────────────────────────────────────────────────────
  await owner.goto(`${BASE}/create`);
  await connect(owner);
  await owner.getByLabel("Name").fill("Fork Test Coin");
  await owner.getByLabel("Ticker").fill("FORK");
  await owner.getByLabel("Description").fill("Launched by the end-to-end test on a Robinhood Chain fork.");
  await owner.getByLabel("X account 1").fill("@alpha_e2e");
  await owner.getByLabel("X account 2").fill("x.com/beta_e2e");
  await owner.getByLabel("Share 1").fill("60");
  await owner.getByLabel("Share 2").fill("40");
  await owner.getByLabel(/first buyer/i).fill("0.05");
  await owner.getByText("✓ alpha_e2e").waitFor({ timeout: 30_000 });
  await owner.getByRole("button", { name: "Launch coin" }).click();
  // The coin page drops ?launched=1 from the URL right after it opens, so match the page itself.
  await owner.waitForURL(/\/token\/0x[0-9a-fA-F]{40}/, { timeout: 90_000 });
  const tokenUrl = owner.url().split("?")[0];
  const tokenAddress = tokenUrl.split("/token/")[1];
  step(`launched FORK via the UI → ${tokenAddress}`);

  // ── 4. Several wallets trade through the UI ──────────────────────────────────────────
  const traders = [];
  for (const [i, acct] of [A, B, C].entries()) {
    const p = await openAs(browser, acct);
    await p.goto(tokenUrl);
    await connect(p);
    const r1 = await trade(p, "buy", ["0.2", "0.35", "0.08"][i], "FORK");
    traders.push(p);
    step(`wallet ${acct.slice(0, 8)} ${r1}`);
  }
  step(`wallet ${B.slice(0, 8)} ${await trade(traders[1], "sell", "50%", "FORK")}`);
  step(`wallet ${C.slice(0, 8)} ${await trade(traders[2], "sell", "Max", "FORK")}`);

  // ── 5. Graduation and pool trading ───────────────────────────────────────────────────
  await (await launchpad.buy(tokenAddress, 0, { value: ethers.parseEther("8") })).wait();
  const g = await launchpad.getToken(tokenAddress);
  if (!g.market[8]) throw new Error("token did not graduate");
  step("whale sold out the curve → graduated to PonSwap");
  await traders[0].goto(tokenUrl);
  await traders[0].getByText("Graduated to PonSwap").waitFor({ timeout: 30_000 });
  step(`pool trade: ${await trade(traders[0], "buy", "0.1", "FORK")}`);
  step(`pool trade: ${await trade(traders[0], "sell", "25%", "FORK")}`);
  await traders[0].waitForTimeout(2500);
  await traders[0].screenshot({ path: `${OUT}/02-token-graduated.png`, fullPage: true });

  // ── 6. Claim with a proof post (mock mode) ───────────────────────────────────────────
  const claimer = traders[1];
  await claimer.goto(`${BASE}/claim`);
  await claimer.getByLabel("Your X username").fill("@alpha_e2e");
  await claimer.getByText("Ready to claim").waitFor({ timeout: 30_000 });
  await claimer.getByRole("button", { name: "Create my proof post" }).click();
  await claimer.getByText(/proof PS-/).waitFor({ timeout: 30_000 });
  await claimer.getByLabel("Link to your post").fill("mock:alpha_e2e");
  await claimer.getByRole("button", { name: "Verify & claim" }).click();
  const sent = claimer.getByText(/^Sent /);
  await sent.waitFor({ timeout: 60_000 });
  step(`@alpha_e2e claimed: ${await sent.textContent()}`);
  await claimer.screenshot({ path: `${OUT}/03-claim.png`, fullPage: true });

  // ── 7. Every page on desktop, mobile and in the light theme (on a phone) ────────────────
  const pages = ["/", "/create", tokenUrl.replace(BASE, ""), "/claim", "/me", "/how", "/setup", "/does-not-exist"];
  for (const [label, opts] of [
    ["desktop", { viewport: { width: 1280, height: 900 } }],
    ["mobile", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
    ["light", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, theme: "light" }],
  ]) {
    const p = await openAs(browser, A, opts);
    for (const path of pages) {
      await p.goto(`${BASE}${path}`, { timeout: 120_000 });
      await p.waitForTimeout(1500);
      const name = path === "/" ? "home" : path.split("/").filter(Boolean)[0];
      // Measure both before and after the page settles (wallet auto-connect, data loads), since
      // late content such as a connected address can be what overflows. Compare with the
      // configured width: in mobile emulation an overflowing page widens innerWidth to fit.
      const measure = () => p.evaluate((w) => document.documentElement.scrollWidth - w, opts.viewport.width);
      const before = await measure();
      await p.waitForTimeout(2500);
      await p.screenshot({ path: `${OUT}/page-${label}-${name}.png`, fullPage: true });
      const overflow = Math.max(before, await measure());
      if (overflow > 0) throw new Error(`${label} ${path}: horizontal overflow ${overflow}px`);
    }
    step(`${label}: ${pages.length} pages render without horizontal overflow`);
  }

  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
  step("no page errors");
  console.log(`\nE2E PASSED (${results.length} checks)`);
} catch (e) {
  console.error("E2E FAILED:", e.message);
  if (errors.length) console.error("page errors:", errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
