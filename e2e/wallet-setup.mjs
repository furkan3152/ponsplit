// End-to-end check of wallet-mode setup (the mainnet default): the owner deploys both contracts
// from their own wallet on /setup, and the site then runs on the pinned addresses.
//
//   node wallet-setup.mjs deploy   app built with NEXT_PUBLIC_SETUP_MODE=wallet, nothing pinned:
//                                  deploys through the UI, checks the chain and that a reload
//                                  resumes instead of deploying again; writes wallet-deploy.env
//   node wallet-setup.mjs pinned   app rebuilt with those addresses pinned: checks /api/setup
//
// Env: BASE (default http://localhost:3000), RPC (default http://127.0.0.1:8545), OWNER (default
// Hardhat #4), OUT (screenshots, default ./shots).
import { mkdirSync, writeFileSync } from "fs";
import { ethers } from "ethers";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3000";
const RPC = process.env.RPC || "http://127.0.0.1:8545";
const OUT = process.env.OUT || "./shots";
mkdirSync(OUT, { recursive: true });
const provider = new ethers.JsonRpcProvider(RPC);
const accounts = await provider.send("eth_accounts", []);
const OWNER = ethers.getAddress(process.env.OWNER || accounts[4]);
const phase = process.argv[2];

const ok = (m) => console.log("✔", m);
const fail = (m) => {
  throw new Error(m);
};
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

async function waitFor(url, ms = 180_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  fail(`timed out waiting for ${url}`);
}

const vaultAbi = ["function owner() view returns (address)", "function signer() view returns (address)", "function launchpad() view returns (address)"];
const launchpadAbi = ["function owner() view returns (address)", "function vault() view returns (address)"];

await waitFor(`${BASE}/api/config`);
const status = await (await fetch(`${BASE}/api/setup`)).json();
if (status.mode !== "wallet") fail(`expected wallet mode, got ${status.mode}`);

if (phase === "deploy") {
  if (status.pinned) fail("addresses are already pinned");
  if (!status.admin) fail("the server has no signing key");
  const refused = await fetch(`${BASE}/api/setup`, { method: "POST" });
  if (refused.ok) fail("the server deployed in wallet mode");
  ok("the server refuses to deploy in wallet mode");

  const walletScript = `(() => {
    let id = 0;
    const rpc = async (method, params) => {
      const r = await fetch(${JSON.stringify(RPC)}, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params || [] }) });
      const j = await r.json();
      if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e; }
      return j.result;
    };
    const eth = {
      request: async ({ method, params }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [${JSON.stringify(OWNER)}];
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

  const nonceBefore = await provider.getTransactionCount(OWNER);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(walletScript);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/setup`, { timeout: 180_000 });
    const deployButton = page.getByRole("button", { name: "Deploy (3 transactions)" });
    const connectButton = page.getByRole("button", { name: "Connect wallet" });
    // The injected test wallet may reconnect by itself; otherwise connect it through the modal.
    await deployButton.or(connectButton).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(3000);
    if (!(await deployButton.count())) {
      await connectButton.click({ timeout: 30_000 });
      await page.waitForTimeout(1200);
      await page.getByText("E2E Wallet").first().click({ force: true, timeout: 10_000 });
    }
    await deployButton.click({ timeout: 60_000 });
    await page.getByText("Important: pin the contract addresses").waitFor({ timeout: 120_000 });
    const lines = await page.locator("pre").first().textContent();
    const vault = ethers.getAddress(/NEXT_PUBLIC_FEE_VAULT_ADDRESS=(0x[0-9a-fA-F]{40})/.exec(lines)[1]);
    const launchpad = ethers.getAddress(/NEXT_PUBLIC_LAUNCHPAD_ADDRESS=(0x[0-9a-fA-F]{40})/.exec(lines)[1]);
    await page.screenshot({ path: `${OUT}/wallet-setup.png`, fullPage: true });

    const v = new ethers.Contract(vault, vaultAbi, provider);
    const l = new ethers.Contract(launchpad, launchpadAbi, provider);
    if (!same(await v.owner(), OWNER) || !same(await l.owner(), OWNER)) fail("the wallet doesn't own both contracts");
    if (!same(await v.signer(), status.admin)) fail("FeeVault doesn't trust the server's signing key");
    if (!same(await v.launchpad(), launchpad) || !same(await l.vault(), vault)) fail("the contracts aren't wired to each other");
    if ((await provider.getTransactionCount(OWNER)) !== nonceBefore + 3) fail("expected exactly three transactions from the wallet");
    ok(`deployed from ${OWNER}: FeeVault ${vault}, launchpad ${launchpad}`);

    // A reload finds the deployment on-chain and offers nothing more to send.
    await page.reload();
    await page.getByText("Important: pin the contract addresses").waitFor({ timeout: 60_000 });
    if (await page.getByRole("button", { name: /Deploy \(3 transactions\)|Continue/ }).count()) fail("a reload offered to deploy again");
    ok("a reload resumes from the chain instead of deploying again");
    if (errors.length) fail(`page errors: ${errors.join("; ")}`);
    writeFileSync("wallet-deploy.env", `NEXT_PUBLIC_FEE_VAULT_ADDRESS=${vault}\nNEXT_PUBLIC_LAUNCHPAD_ADDRESS=${launchpad}\n`);
  } finally {
    await browser.close();
  }
} else if (phase === "pinned") {
  if (!status.pinned || !status.done) fail(`expected a pinned, finished setup: ${JSON.stringify(status)}`);
  if (!status.signerMatches) fail("FeeVault's signer isn't this server's key");
  if (!same(status.owner, OWNER) || !same(status.vaultOwner, OWNER)) fail("the wallet doesn't own both contracts");
  ok("the pinned site sees its contracts, owned by the wallet, trusting its signing key");
} else {
  fail("usage: node wallet-setup.mjs deploy|pinned");
}
console.log(`\nWALLET SETUP ${phase.toUpperCase()} PASSED`);
