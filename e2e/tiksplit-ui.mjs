// Setup-mode UI smoke test. Runs against a real local server; never intercepts or fabricates API responses.
// BASE=http://localhost:3000 node e2e/tiksplit-ui.mjs
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = process.env.BASE || 'http://localhost:3000';
const out = process.env.OUT || join(fileURLToPath(new URL('.', import.meta.url)), 'shots');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const pages = ['/', '/create', '/claim', '/explore', '/me', '/how', '/docs', '/creator/test.creator'];
const results = [];
const failures = [];
try {
  for (const [viewport, size] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const jsErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => jsErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    for (const path of pages) {
      jsErrors.length = 0;
      consoleErrors.length = 0;
      const response = await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(1700);
      const details = await page.evaluate(() => {
        const width = window.innerWidth;
        const visible = (element) => Boolean(element.getClientRects().length);
        const unnamed = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')].filter((element) => visible(element) && !element.labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')).map((element) => element.id || element.outerHTML.slice(0, 100));
        const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - width;
        const wide = [...document.querySelectorAll('main *')].filter((element) => {
          if (!visible(element)) return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && (rect.right > width + 1 || rect.left < -1);
        }).slice(0, 8).map((element) => ({ tag: element.tagName, class: String(element.className).slice(0, 100), text: element.textContent?.slice(0, 80) }));
        const sidebar = document.querySelector('.sidebar');
        const main = document.querySelector('main');
        const sidebarOverlap = sidebar && main && visible(sidebar) && main.getBoundingClientRect().left < sidebar.getBoundingClientRect().right - 1;
        return { overflow, wide, unnamed, sidebarOverlap, h1: document.querySelector('h1')?.textContent, text: document.body.innerText };
      });
      if (response?.status() !== 200) failures.push(`${viewport} ${path}: HTTP ${response?.status()}`);
      if (details.sidebarOverlap) failures.push(`${viewport} ${path}: sidebar overlaps main content`);
      if (details.overflow > 1) failures.push(`${viewport} ${path}: horizontal overflow ${details.overflow}px`);
      if (details.unnamed.length) failures.push(`${viewport} ${path}: unnamed visible inputs ${details.unnamed.join(', ')}`);
      if (consoleErrors.length) failures.push(`${viewport} ${path}: browser console errors ${consoleErrors.join('; ')}`);
      if (jsErrors.length) failures.push(`${viewport} ${path}: JS errors ${jsErrors.join('; ')}`);
      if (path === '/') {
        if (!details.text.includes('Mainnet launch is in preparation.')) failures.push(`${viewport}: missing home setup state`);
        const counts = await page.locator('section[aria-label="On-chain activity"] .num').allTextContents();
        if (counts.some((count) => count !== '—')) failures.push(`${viewport}: unconfigured stats display numeric totals ${counts}`);
      }
      if (path === '/create') {
        const launchButton = page.getByRole('button', { name: 'Mainnet launches are paused', exact: true });
        if (!(await launchButton.isDisabled())) failures.push(`${viewport}: unconfigured launch is enabled`);
        for (const label of ['TikTok username', 'Coin name', 'Ticker', 'Description', 'Launcher reward (%)', 'First buy (SOL)']) {
          if (!(await page.getByLabel(label, { exact: false }).count())) failures.push(`${viewport}: missing label ${label}`);
        }
      }
      if (path === '/claim' || path.startsWith('/creator/')) {
        if (!details.text.includes('TikTok sign-in is not configured on this deployment.')) failures.push(`${viewport} ${path}: missing OAuth unavailable state`);
        if (await page.getByRole('link', { name: 'Connect TikTok account' }).count()) failures.push(`${viewport} ${path}: OAuth CTA exposed without config`);
        const claimButton = page.getByRole('button', { name: 'Verify a wallet to claim', exact: true });
        if (!(await claimButton.isDisabled())) failures.push(`${viewport} ${path}: unverified claim is enabled`);
      }
      if (path === '/' || path === '/create') {
        const name = path === '/' ? 'home' : 'create';
        await page.screenshot({ path: `${out}/${name}-${viewport}-viewport.png` });
        await page.screenshot({ path: `${out}/${name}-${viewport}-dark.png`, fullPage: true });
      }
      results.push({ viewport, path, status: response?.status(), h1: details.h1, overflow: details.overflow, wide: details.wide, unnamed: details.unnamed, jsErrors: [...jsErrors], consoleErrors: [...consoleErrors] });
    }
    // Verify mobile search and wallet dialogs remain functional without any wallet signatures.
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    if (viewport === 'mobile') {
      await page.getByRole('button', { name: 'Search coins', exact: true }).click();
      if (!(await page.getByRole('searchbox').count()) && !(await page.getByRole('textbox', { name: 'Search coins', exact: true }).isVisible())) failures.push('mobile: compact search did not open');
      await page.getByRole('textbox', { name: 'Search coins', exact: true }).press('Escape');
    }
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
    if (!(await page.locator('.wallet-adapter-modal').isVisible())) failures.push(`${viewport}: wallet modal did not open`);
    await page.locator('.wallet-adapter-modal-button-close').click();
    if (viewport === 'desktop') {
      await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
      const folded = await page.locator('html').getAttribute('data-sidebar');
      if (folded !== 'folded') failures.push('desktop: sidebar did not collapse');
      await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Switch to the light theme', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/home-${viewport}-light.png`, fullPage: true });
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/smoke-results.json`, JSON.stringify({ results, failures }, null, 2));
console.log(JSON.stringify({ checked: results.length, failures, runtimeErrors: results.flatMap((result) => result.jsErrors), consoleErrors: results.flatMap((result) => result.consoleErrors) }, null, 2));
if (failures.length) process.exitCode = 1;
