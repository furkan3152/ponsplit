// Full-page screenshots of every page for design review: dark and light, desktop and mobile, each
// page scrolled through first so scroll reveals have rendered.
//
//   BASE=http://localhost:3000 OUT=/tmp/shots TOKEN=<a mint> [ONLY=home,token] node screens.mjs
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT;
const TOKEN = process.env.TOKEN;
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const pages = [["home", "/"], ["create", "/create"], ["token", `/token/${TOKEN}`], ["claim", "/claim"], ["me", "/me"], ["how", "/how"], ["404", "/nope"]].filter(([n]) => !only || only.includes(n));
const b = await chromium.launch();
for (const theme of ["dark", "light"]) {
  for (const [vp, size] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const ctx = await b.newContext({ viewport: size, deviceScaleFactor: vp === "mobile" ? 2 : 1 });
    await ctx.addInitScript((t) => localStorage.setItem("ponsplit:theme", t), theme);
    const p = await ctx.newPage();
    for (const [name, path] of pages) {
      await p.goto(BASE + path, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});
      await p.waitForTimeout(1500);
      const h = await p.evaluate(() => document.body.scrollHeight);
      for (let y = 0; y < h; y += 400) {
        await p.evaluate((yy) => window.scrollTo(0, yy), y);
        await p.waitForTimeout(120);
      }
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(1600);
      await p.screenshot({ path: `${OUT}/${name}-${vp}-${theme}.png`, fullPage: true });
    }
    await ctx.close();
  }
}
await b.close();
console.log("shots done");
