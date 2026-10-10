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
const pages = ['/', '/create', '/claim', '/explore', '/me', '/how', '/docs', '/creator/test.creator', '/admin', '/privacy', '/terms'];
const expectedAdmin = process.env.EXPECTED_ADMIN_WALLET || 'D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm';
const results = [];
const failures = [];
const apiResults = [];
async function captureFullPage(page, path) {
  // Use the app's real reduced-motion mode so below-the-fold Reveal sections are visible in the image.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    await page.screenshot({ path, fullPage: true });
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
}
try {
  for (const [viewport, size] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const jsErrors = [];
    const consoleErrors = [];
    const tikTokApiRequests = [];
    page.on('pageerror', (error) => jsErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/tiktok/')) tikTokApiRequests.push(new URL(request.url()).pathname); });
    for (const path of pages) {
      jsErrors.length = 0;
      consoleErrors.length = 0;
      tikTokApiRequests.length = 0;
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
      if (path === '/') {
        if (!details.text.includes('Mainnet launch is in preparation.')) failures.push(`${viewport}: missing home setup state`);
        if (!/manual review/i.test(details.text) || !/public TikTok video/i.test(details.text)) failures.push(`${viewport}: home does not explain manual video verification`);
        const counts = await page.locator('section[aria-label="On-chain activity"] .num').allTextContents();
        if (counts.length !== 3) failures.push(`${viewport}: expected three on-chain metrics`);
        if (counts.some((count) => count !== '—')) failures.push(`${viewport}: unconfigured stats display numeric totals ${counts}`);
      }
      if (path === '/how') {
        if (!/public video/i.test(details.text) || !/manually checks/i.test(details.text)) failures.push(`${viewport}: how guide does not explain public proof video and admin review`);
        if (/signs in with TikTok/i.test(details.text)) failures.push(`${viewport}: how guide still presents TikTok sign-in as the default verification flow`);
      }
      if (path === '/create') {
        const launchButton = page.getByRole('button', { name: 'Mainnet launches are paused', exact: true });
        if (!(await launchButton.isDisabled())) failures.push(`${viewport}: unconfigured launch is enabled`);
        for (const label of ['TikTok username', 'Coin name', 'Ticker', 'Description', 'First buy (SOL)']) {
          if (!(await page.getByLabel(label, { exact: false }).count())) failures.push(`${viewport}: missing label ${label}`);
        }
      }
      if (path === '/claim' || path.startsWith('/creator/')) {
        // Enter a real-format handle to display CreatorProof; no chain state or API response is fabricated.
        if (path === '/claim') {
          await page.getByLabel('Explore a TikTok creator', { exact: true }).fill('test.creator');
          await page.waitForTimeout(550);
        }
        const proofText = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
        if (!/Verify with a TikTok video\./i.test(proofText) || !/video caption.*admin review/i.test(proofText)) failures.push(`${viewport} ${path}: missing manual proof-video instructions`);
        if (!proofText.includes('Video verification is paused until the reviewed mainnet escrow and admin verification authority are configured.')) failures.push(`${viewport} ${path}: missing video verification unavailable state`);
        if (await page.locator('a[href^="/api/tiktok/"]').count() || await page.getByRole('link', { name: /Connect TikTok account|Sign in with TikTok/i }).count()) failures.push(`${viewport} ${path}: TikTok OAuth CTA exposed in manual flow`);
        const claimButton = page.getByRole('button', { name: 'Verify with a video to claim', exact: true });
        if (!(await claimButton.isDisabled())) failures.push(`${viewport} ${path}: unverified claim is enabled`);
        const proofActions = page.getByRole('button', { name: /Create my verification code|Submit video for admin review|Activate approved wallet/i });
        for (const action of await proofActions.all()) {
          if (!(await action.isDisabled())) failures.push(`${viewport} ${path}: unconfigured verification action is enabled`);
        }
        if (/\bTIK-[a-z0-9_.]+-[1-9A-HJ-NP-Za-km-z]{32,44}-[a-f0-9]+\b/i.test(proofText)) failures.push(`${viewport} ${path}: proof code appeared without an on-chain request`);
        if (tikTokApiRequests.length) failures.push(`${viewport} ${path}: manual verification called TikTok API routes ${tikTokApiRequests.join(', ')}`);
        const proofOverflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
        if (proofOverflow > 1) failures.push(`${viewport} ${path}: proof panel horizontal overflow ${proofOverflow}px`);
      }
      if (path === '/admin') {
        const gateText = details.text.replace(/\s+/g, ' ').toLowerCase();
        if (!gateText.includes('sign with the admin wallet.') || !gateText.includes('your browser checks the signature') || !gateText.includes('15 minutes')) failures.push(`${viewport}: anonymous admin page did not explain its wallet-signature gate`);
        if (await page.getByRole('button', { name: /Collect platform fees|Deploy.*mainnet|Deploy program|Approve.*video|Review.*proof/i }).count()) failures.push(`${viewport}: anonymous admin page exposed a privileged action`);
        if (await page.getByRole('link', { name: 'Admin studio', exact: true }).count()) failures.push(`${viewport}: anonymous sidebar exposed admin navigation`);
      }
      if (['/', '/create', '/claim', '/how', '/creator/test.creator', '/admin'].includes(path)) {
        const name = path === '/' ? 'home' : path.startsWith('/creator/') ? 'creator-proof' : path.slice(1);
        await page.screenshot({ path: `${out}/${name}-${viewport}-viewport.png` });
        await captureFullPage(page, `${out}/${name}-${viewport}-dark.png`);
      }
      if (consoleErrors.length) failures.push(`${viewport} ${path}: browser console errors ${consoleErrors.join('; ')}`);
      if (jsErrors.length) failures.push(`${viewport} ${path}: JS errors ${jsErrors.join('; ')}`);
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
    for (const path of ['/', '/claim', '/creator/test.creator', '/admin', '/how']) {
      await page.goto(base + path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(550);
      if (path === '/claim') {
        await page.getByLabel('Explore a TikTok creator', { exact: true }).fill('test.creator');
        await page.waitForTimeout(550);
      }
      const name = path === '/' ? 'home' : path.startsWith('/creator/') ? 'creator-proof' : path.slice(1);
      await page.screenshot({ path: `${out}/${name}-${viewport}-light-viewport.png` });
      await captureFullPage(page, `${out}/${name}-${viewport}-light.png`);
    }
    await context.close();
  }
  const api = await browser.newContext();
  for (const endpoint of ['/api/admin/status', '/api/admin/fees']) {
    const response = await api.request.get(base + endpoint);
    if (![401, 403, 503].includes(response.status())) failures.push(`${endpoint}: anonymous access returned ${response.status()}`);
    const body = await response.json();
    apiResults.push({ endpoint, status: response.status(), code: body.code });
    if (!body.error || body.coins || body.configuration) failures.push(`${endpoint}: protected data exposed to anonymous request`);
  }
  const sessionResponse = await api.request.get(base + '/api/admin/session');
  const session = await sessionResponse.json();
  if (sessionResponse.status() !== 200 || session.authenticated !== false || session.wallet !== null) failures.push('Anonymous admin session grants privileges');
  apiResults.push({ endpoint: '/api/admin/session', status: sessionResponse.status(), authenticated: session.authenticated });
  const runtimeResponse = await api.request.get(base + '/api/runtime-status');
  const runtime = await runtimeResponse.json();
  if (runtimeResponse.status() !== 200) failures.push(`Public runtime readiness returned ${runtimeResponse.status()}`);
  if (runtime.launchesReady !== false || runtime.configuration?.escrowProgram?.address !== null || runtime.deployment?.configuredProgram !== null) failures.push('Unconfigured runtime readiness does not keep mainnet launches unavailable');
  if (runtime.verificationMode !== 'video' || runtime.configuration?.verifier?.address !== expectedAdmin || runtime.admin !== expectedAdmin) failures.push('Runtime readiness does not identify native admin video verification');
  if (runtime.network !== 'mainnet' || runtime.platformBps !== 2000) failures.push('Runtime readiness does not reflect the fixed mainnet 20/80 fee policy');
  const forbiddenKeys = [];
  function inspectPublicFields(value, prefix = '') {
    if (!value || typeof value !== 'object') return;
    for (const [key, field] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (/private.?key|secret|password|rpc.?url|rpc.?endpoint|access.?token|refresh.?token|api.?key|jwt|authorization|cookie|session.?key|credential/i.test(key)) forbiddenKeys.push(path);
      inspectPublicFields(field, path);
    }
  }
  inspectPublicFields(runtime);
  if (forbiddenKeys.length || /https?:\/\//i.test(JSON.stringify(runtime))) failures.push(`Public readiness includes credentials or service URLs: ${forbiddenKeys.join(', ')}`);
  apiResults.push({ endpoint: '/api/runtime-status', status: runtimeResponse.status(), launchesReady: runtime.launchesReady, verificationMode: runtime.verificationMode, program: runtime.configuration?.escrowProgram?.address, verifier: runtime.configuration?.verifier?.address, artifactAvailable: runtime.deployment?.artifactAvailable });
  await api.close();
} finally { await browser.close(); }
await writeFile(`${out}/smoke-results.json`, JSON.stringify({ results, apiResults, failures }, null, 2));
console.log(JSON.stringify({ checked: results.length, apiResults, failures, runtimeErrors: results.flatMap((result) => result.jsErrors), consoleErrors: results.flatMap((result) => result.consoleErrors) }, null, 2));
if (failures.length) process.exitCode = 1;
