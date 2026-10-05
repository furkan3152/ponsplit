// The whole Splidev site in a real browser, on a local solana-test-validator running pump.fun's own
// programs (e2e/solana/fixtures): a creator launches a coin for two real GitHub accounts through
// /create, traders buy and sell on the coin page, anyone distributes the creator fees, and the
// claim page shows what the developers have waiting. Wallets are throwaway local keypairs behind a
// Wallet Standard wallet injected into the page; signing happens here, in Node.
//
//   BASE=http://localhost:3000 RPC=http://127.0.0.1:8899 TREASURY=<treasury pubkey> node splidev.mjs
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3000";
const RPC = process.env.RPC || "http://127.0.0.1:8899";
const TREASURY = new PublicKey(process.env.TREASURY);
const OUT = process.env.OUT || "./shots";
const c = new Connection(RPC, "confirmed");
const fail = (m) => {
  throw new Error(m);
};
const step = (m) => console.log("✔", m);

async function fund(k, sol) {
  await c.confirmTransaction(await c.requestAirdrop(k, sol * LAMPORTS_PER_SOL), "confirmed");
}

/** A Wallet Standard wallet in the page whose signing happens in Node with `kp`. */
const walletScript = ({ address, publicKey }) => {
  const account = { address, publicKey: new Uint8Array(publicKey), chains: ["solana:mainnet", "solana:localnet"], features: ["solana:signTransaction"] };
  const listeners = {};
  const wallet = {
    version: "1.0.0",
    name: "E2E Wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiNjY2ZmMDAiLz48L3N2Zz4=",
    chains: ["solana:mainnet", "solana:localnet"],
    accounts: [account],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
      "standard:events": {
        version: "1.0.0",
        on: (event, listener) => {
          (listeners[event] ||= []).push(listener);
          return () => {};
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs) =>
          Promise.all(inputs.map(async ({ transaction }) => ({ signedTransaction: new Uint8Array(await window.__e2eSign(Array.from(transaction))) }))),
      },
    },
  };
  const register = ({ register }) => register(wallet);
  window.addEventListener("wallet-standard:app-ready", ({ detail }) => register(detail));
  try {
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  } catch {}
};

async function openAs(browser, kp, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  // Accept the one-time risk notice up front.
  await ctx.addInitScript(() => localStorage.setItem("splidev:risk-ack:v1", "1"));
  await ctx.addInitScript(walletScript, { address: kp.publicKey.toBase58(), publicKey: Array.from(kp.publicKey.toBytes()) });
  const page = await ctx.newPage();
  await page.exposeFunction("__e2eSign", (bytes) => {
    const tx = VersionedTransaction.deserialize(Uint8Array.from(bytes));
    tx.sign([kp]);
    return Array.from(tx.serialize());
  });
  page.on("pageerror", (e) => console.log("page error:", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text().slice(0, 4000)));
  return page;
}

async function connect(page) {
  const btn = page.getByRole("button", { name: "Connect", exact: true }).first();
  if (!(await btn.isVisible().catch(() => false))) return;
  await btn.click();
  await page.getByRole("button", { name: /E2E Wallet/ }).first().click({ timeout: 15_000 });
  await page.getByRole("button", { name: /Connect$/ }).first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
}

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
try {
  // ── Pages load and never widen the screen ───────────────────────────────────────────────
  for (const path of ["/", "/explore", "/create", "/claim", "/how", "/docs", "/me", "/nope"]) {
    for (const width of [1280, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const p = await ctx.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      const res = await p.goto(BASE + path, { waitUntil: "networkidle", timeout: 90_000 });
      if (path !== "/nope" && !res.ok()) fail(`${path} answered ${res.status()}`);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) fail(`${path} is ${over}px wider than a ${width}px screen`);
      if (errors.length) fail(`${path} threw: ${errors.join(" | ")}`);
      await ctx.close();
    }
  }
  step("every page loads without errors or sideways scroll, on desktop and phone");

  // ── Launch through /create ──────────────────────────────────────────────────────────────
  const creator = Keypair.generate();
  await fund(creator.publicKey, 20);
  const treasuryBefore = await c.getBalance(TREASURY);
  const page = await openAs(browser, creator);
  await page.goto(`${BASE}/create`, { waitUntil: "networkidle" });
  await connect(page);
  await page.getByLabel("Name").fill("E2E Dev Coin");
  await page.getByLabel("Ticker").fill("DEVE2E");
  await page.getByLabel("Description").fill("Launched by the end-to-end test on a local validator with pump.fun's programs.");
  await page.getByLabel("GitHub account 1").fill("torvalds");
  await page.getByLabel("GitHub account 2").fill("github.com/gaearon");
  await page.getByLabel("Share 1").fill("60");
  await page.getByLabel("Share 2").fill("40");
  await page.getByLabel("Be the first buyer").fill("0.1");
  await page.getByText(/^✓ /).nth(1).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: /Launch coin/ }).click();
  await page.waitForURL(/\/token\/[1-9A-HJ-NP-Za-km-z]{32,44}/, { timeout: 180_000 });
  const mint = page.url().split("/token/")[1].split("?")[0];
  await page.getByText("$DEVE2E is live.").waitFor({ timeout: 60_000 });
  step(`launched $DEVE2E through the UI → ${mint}`);
  const fee = (await c.getBalance(TREASURY)) - treasuryBefore;
  if (fee < 0.01 * LAMPORTS_PER_SOL) fail(`the treasury got ${fee} lamports of launch fee`);
  await page.getByText("@torvalds").first().waitFor({ timeout: 60_000 });
  await page.getByText("@gaearon").first().waitFor({ timeout: 60_000 });
  step(`the coin page shows its GitHub split (@torvalds, @gaearon); the launch fee reached the treasury (${fee / LAMPORTS_PER_SOL} SOL)`);
  await page.screenshot({ path: `${OUT}/launched.png`, fullPage: true });

  // ── Trades on the coin page ─────────────────────────────────────────────────────────────
  const trader = Keypair.generate();
  await fund(trader.publicKey, 20);
  const tp = await openAs(browser, trader);
  await tp.goto(`${BASE}/token/${mint}`, { waitUntil: "networkidle" });
  await connect(tp);
  await tp.getByLabel("SOL amount").fill("1");
  await tp.getByRole("button", { name: "Buy DEVE2E" }).click();
  await tp.getByText(/^Bought about/).waitFor({ timeout: 120_000 });
  step("a trader bought 1 SOL of the coin on the curve through the trade panel");
  await tp.getByRole("button", { name: "sell" }).click();
  await tp.getByRole("button", { name: "50%" }).click();
  await tp.getByRole("button", { name: "Sell DEVE2E" }).click();
  await tp.getByText(/^Sold for about/).waitFor({ timeout: 120_000 });
  step("…and sold half of it");
  await tp.getByRole("row").filter({ hasText: /Sell/ }).first().waitFor({ timeout: 60_000 });
  step("the trades show up in the coin's trade list");

  // ── Distribute, then the claim page sees it ─────────────────────────────────────────────
  await tp.getByRole("button", { name: "Distribute now" }).click();
  await tp.getByText(/^Distributed\./).waitFor({ timeout: 120_000 });
  step("anyone can distribute the creator fees from the coin page");
  await tp.goto(`${BASE}/claim`, { waitUntil: "networkidle" });
  await tp.getByLabel("GitHub username").fill("torvalds");
  await tp.getByText("Ready to claim on pump.fun").waitFor({ timeout: 60_000 });
  await tp.getByText("E2E Dev Coin").first().waitFor({ timeout: 60_000 });
  const ready = await tp.locator("dd").filter({ hasText: "SOL" }).first().innerText();
  if (/^0(\.0+)?\s*SOL/.test(ready.trim())) fail(`the claim page shows nothing ready for @torvalds: ${ready}`);
  step(`the claim page shows @torvalds's share waiting on pump.fun (${ready.replace(/\s+/g, " ")}) and the coin that pays it`);
  await tp.screenshot({ path: `${OUT}/claim.png`, fullPage: true });

  // ── Lists ──────────────────────────────────────────────────────────────────────────────
  await tp.goto(`${BASE}/explore`, { waitUntil: "networkidle" });
  await tp.getByText("E2E Dev Coin").first().waitFor({ timeout: 60_000 });
  await tp.goto(`${BASE}/me`, { waitUntil: "networkidle" });
  await tp.getByText("E2E Dev Coin").first().waitFor({ timeout: 60_000 });
  step("the coin is listed on Explore, and the trader's portfolio holds it");
} catch (e) {
  // Leave a trail: a screenshot and the visible text of every open page.
  let n = 0;
  for (const ctx of browser.contexts())
    for (const p of ctx.pages()) {
      n++;
      await p.screenshot({ path: `${OUT}/failure-${n}.png`, fullPage: true }).catch(() => {});
      const text = await p.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText).catch(() => "");
      console.log(`\n── page ${n}: ${p.url()}\n${text.replace(/\n{2,}/g, "\n").slice(0, 2500)}`);
    }
  throw e;
} finally {
  await browser.close();
}
console.log("\nAll Splidev browser checks passed.");
