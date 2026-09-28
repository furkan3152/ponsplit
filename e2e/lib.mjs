// Shared pieces of the end-to-end tests: the chain, an injected test wallet and page helpers.
import { mkdirSync } from "fs";
import { ethers } from "ethers";

export const BASE = process.env.BASE || "http://localhost:3000";
export const RPC = process.env.RPC || "http://127.0.0.1:8545";
/** The network the tests run the site on (the node is a fork of it). */
export const NETWORK = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet";
export const OUT = process.env.OUT || "./shots";
mkdirSync(OUT, { recursive: true });

export const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
export const accounts = (await provider.send("eth_accounts", [])).map((a) => ethers.getAddress(a));
/** The owner deploys everything from /setup; the others trade. Hardhat's #0 is avoided (see prepare-fork.mjs). */
export const [OWNER, A, B, C, WHALE] = [accounts[4], accounts[5], accounts[6], accounts[7], accounts[8]];

export const results = [];
export const step = (m) => {
  results.push(m);
  console.log("✔", m);
};
export const fail = (m) => {
  throw new Error(m);
};
export const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

export async function waitFor(url, ms = 180_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  fail(`timed out waiting for ${url}`);
}

/** EIP-1193/6963 wallet backed by an unlocked node account; it confirms everything at once. */
export const walletScript = (account) => `(() => {
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

export const errors = [];

/** A browser context for `account`, browsing the site on NETWORK (the cookie the header switch sets). */
export async function openAs(browser, account, { theme, network = NETWORK, ...opts } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  await ctx.addCookies([{ name: "pe-network", value: network, url: BASE }]);
  // The site's theme is <html data-theme> from localStorage (dark by default), not the OS setting.
  if (theme) await ctx.addInitScript((t) => localStorage.setItem("ponsplit:theme", t), theme);
  // The one-time mainnet risk notice (RiskNotice.tsx) is acknowledged, as a returning visitor has.
  await ctx.addInitScript(() => localStorage.setItem("ponsplit:risk-ack:v1", "1"));
  await ctx.addInitScript(walletScript(account));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${account.slice(0, 8)}: ${e.message}`));
  page.on("dialog", (d) => d.accept());
  return page;
}

/** Connects the injected wallet if the page isn't connected yet. */
export async function connect(page) {
  await page.waitForTimeout(2500);
  if (await page.locator("header").getByText(/0x[0-9a-f]{2}/i).count()) return;
  await page.getByRole("button", { name: "Connect", exact: true }).first().click({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.getByText("E2E Wallet").first().click({ force: true, timeout: 5000 }).catch(() => {});
  await page.locator("header").getByText(/0x[0-9a-f]{2}/i).first().waitFor({ timeout: 20_000 });
}
