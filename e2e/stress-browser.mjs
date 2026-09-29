// Many real browsers opening the live site at once (phones and desktops, both networks), as a
// launch-day crowd would. For each visit: time until the page is usable and its chain data shows,
// how long the main thread was blocked (the page "freezing"), page errors, and horizontal overflow.
//
//   SITE=https://splitearn.app COIN=0x… VISITORS=12 node stress-browser.mjs
import { chromium } from "playwright";

const SITE = (process.env.SITE || "https://splitearn.app").replace(/\/$/, "");
const COIN = process.env.COIN || "";
const VISITORS = Number(process.env.VISITORS || 12);

const routes = [
  { path: "/", ready: () => "text=Route coin fees" },
  { path: "/explore", ready: () => "h1:has-text('Explore')" },
  { path: "/claim", ready: () => "text=Claim your" },
  ...(COIN ? [{ path: `/token/${COIN}`, ready: () => "text=MAINNET" }] : []),
];

const browser = await chromium.launch();
const visit = async (i) => {
  const mobile = i % 2 === 0;
  const network = i % 3 === 0 ? "testnet" : "mainnet";
  const route = routes[i % routes.length];
  const ctx = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }
  );
  await ctx.addCookies([{ name: "pe-network", value: network, url: SITE }]);
  await ctx.addInitScript(() => {
    localStorage.setItem("ponsplit:risk-ack:v1", "1");
    // Main-thread blocking: every task over 50 ms, as the browser reports it.
    window.__blocked = 0;
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__blocked += e.duration - 50))).observe({ type: "longtask", buffered: true });
    } catch {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
  const failedRequests = [];
  page.on("requestfailed", (r) => failedRequests.push(`${r.url().slice(0, 60)} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 500 && failedRequests.push(`${r.status()} ${r.url().slice(0, 80)}`));
  const t0 = Date.now();
  let usable = null;
  let dataMs = null;
  try {
    await page.goto(SITE + route.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator(route.ready()).first().waitFor({ timeout: 60_000 });
    usable = Date.now() - t0;
    // Chain data: the page stops showing loading skeletons (or the coin's numbers appear).
    await page.waitForFunction(() => document.querySelectorAll(".animate-pulse").length === 0, null, { timeout: 45_000 }).catch(() => {});
    dataMs = Date.now() - t0;
    await page.waitForTimeout(4000);
  } catch (e) {
    errors.push(`load: ${String(e.message).split("\n")[0]}`);
  }
  const blocked = await page.evaluate(() => Math.round(window.__blocked)).catch(() => -1);
  const overflow = await page.evaluate((w) => document.documentElement.scrollWidth - w, mobile ? 390 : 1440).catch(() => 0);
  const stillLoading = await page.locator(".animate-pulse").count().catch(() => -1);
  // Which skeletons never went away (their nearest labelled section), to tell a stuck read from a design choice.
  const stuck = await page
    .evaluate(() =>
      [...document.querySelectorAll(".animate-pulse")].map((el) => {
        const box = el.closest("section, [aria-label], main > *");
        return `${el.className.split(" ").slice(0, 3).join(".")} in ${box?.getAttribute("aria-label") || box?.querySelector("h1,h2,h3,.eyebrow")?.textContent?.slice(0, 40) || box?.tagName}`;
      })
    )
    .catch(() => []);
  await ctx.close();
  return { i, route: route.path, network, device: mobile ? "phone" : "desktop", usable, dataMs, blocked, overflow, stillLoading, stuck, errors, failedRequests };
};

const started = Date.now();
const results = await Promise.all(Array.from({ length: VISITORS }, (_, i) => visit(i)));
await browser.close();

for (const r of results) {
  console.log(
    `${r.errors.length || r.failedRequests.length ? "✘" : "✔"} ${r.device.padEnd(7)} ${r.network.padEnd(7)} ${r.route.padEnd(14).slice(0, 14)} usable ${r.usable ?? "-"} ms · data ${r.dataMs ?? "-"} ms · main thread blocked ${r.blocked} ms · skeletons left ${r.stillLoading}${r.overflow > 0 ? ` · OVERFLOW ${r.overflow}px` : ""}`
  );
  for (const e of r.errors) console.log(`    page error: ${e}`);
  for (const s of r.stuck) console.log(`    still loading: ${s}`);
  for (const f of r.failedRequests.slice(0, 5)) console.log(`    request: ${f}`);
}
const ok = results.filter((r) => r.usable !== null);
const sorted = (k) => ok.map((r) => r[k]).filter((v) => v !== null).sort((a, b) => a - b);
const p = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : "-");
console.log(
  `\n${VISITORS} visitors at once in ${((Date.now() - started) / 1000).toFixed(1)} s: usable p50 ${p(sorted("usable"), 0.5)} ms / max ${p(sorted("usable"), 0.99)} ms; data p50 ${p(sorted("dataMs"), 0.5)} ms / max ${p(sorted("dataMs"), 0.99)} ms; worst main-thread blocking ${Math.max(...results.map((r) => r.blocked))} ms`
);
const failed = results.filter((r) => r.usable === null || r.errors.length || r.overflow > 0).length;
console.log(failed ? `BROWSER: ${failed} of ${VISITORS} visits had problems` : "BROWSER: every visit loaded, no page errors");
if (failed) process.exit(1);
