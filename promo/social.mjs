// X (Twitter) profile pictures and header banner for Splitdev, in the "night shift" look. Bitbug comes from
// src/components/art/Bug.tsx; Chromium renders the HTML below and screenshots it.
//
//   CHROMIUM=… OUTDIR=dir node promo/social.mjs
// Writes pp-night.png, pp-day.png (1000×1000, safe inside X's circle crop) and banner.png (3000×1000, X's 3:1).
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { transform } from "sucrase";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const OUT = process.env.OUTDIR || ".";
mkdirSync(OUT, { recursive: true });

// ── Bitbug as inline SVG with literal colors ──────────────────────────────────────────────
const cache = join(root, "node_modules", ".cache", "social");
mkdirSync(cache, { recursive: true });
for (const f of ["parts", "Bug"]) {
  const src = readFileSync(join(root, "src/components/art", `${f}.tsx`), "utf8");
  const { code } = transform(src, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true });
  writeFileSync(join(cache, `${f}.cjs`), code.replace(/require\(['"]\.\/(\w+)['"]\)/g, 'require("./$1.cjs")'));
}
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { Bug } = require(join(cache, "Bug.cjs"));
const { CodeTag, Braces, Sparkle } = require(join(cache, "parts.cjs"));
const NIGHT = { lime: "#ff7a3d", green: "#3ddc97", sun: "#ffd45c", pink: "#ff8ccf", lilac: "#a98dff", sky: "#66c7ff", outline: "#130d26", shine: "#ffffff", "bug-limb": "#8d82b8", "ink-3": "#9087b0" };
const DAY = { ...NIGHT, "bug-limb": "#1b1433", "ink-3": "#686084" };
const svg = (el, palette, viewBox, attrs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ${attrs}>${renderToStaticMarkup(el)}</svg>`.replace(/var\(--([\w-]+)(?:,\s*[^)]+)?\)/g, (m, n) => palette[n] ?? m);
const h = React.createElement;

// ── fonts, inlined (curl honours the proxy) ───────────────────────────────────────────────
const curl = (url) => execFileSync("curl", ["-sSL", "-m", "30", "-A", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Chrome/141 Safari/537.36", url], { maxBuffer: 64 << 20 });
let FONTS = curl("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=JetBrains+Mono:wght@400;600;700&family=Fraunces:ital,opsz,wght@1,9..144,600&display=block").toString();
for (const u of new Set(FONTS.match(/https:[^)]+\.woff2/g) || [])) FONTS = FONTS.split(u).join(`data:font/woff2;base64,${curl(u).toString("base64")}`);

const base = `
  ${FONTS}
  * { box-sizing: border-box; margin: 0; }
  body { width: max-content; }
  .mono { font-family: "JetBrains Mono", monospace; font-variant-ligatures: none; }
  .disp { font-family: "Space Grotesk", sans-serif; }
  .accent { font-family: "Fraunces", serif; font-style: italic; font-weight: 600; font-variation-settings: "SOFT" 100, "WONK" 1; }
  .squiggle { text-decoration: underline wavy #ff7a3d; text-decoration-thickness: 0.06em; text-underline-offset: 0.16em; text-decoration-skip-ink: none; }
  .dots { background-image: radial-gradient(var(--dot) 1.6px, transparent 2px); background-size: var(--gap) var(--gap); }
`;

// ── profile pictures ──────────────────────────────────────────────────────────────────────
// Everything that matters sits inside the circle X crops to; the bug leans in like it's peeking.
function pp(theme) {
  const night = theme === "night";
  const pal = night ? NIGHT : DAY;
  const bug = svg(h(Bug, { x: 60, y: 60, size: 120, face: "wink", shadow: false, sw: 3.2 }), pal, "-4 -6 128 132", 'width="620" height="636"');
  const tag = svg(h(CodeTag, { x: 20, y: 20, s: 30, sw: 1.6, color: "var(--sky)", rot: 12 }), pal, "0 0 40 40", 'width="150" height="150"');
  const spark = svg(h(Sparkle, { x: 20, y: 20, s: 13, sw: 2.2, color: "var(--sun)" }), pal, "0 0 40 40", 'width="96" height="96"');
  const braces = svg(h(Braces, { x: 20, y: 20, s: 26, sw: 1.5, color: "var(--pink)", rot: -14 }), pal, "0 0 40 40", 'width="120" height="120"');
  return `<!doctype html><html><head><style>${base}
    .pp { position: relative; width: 1000px; height: 1000px; overflow: hidden;
      background-color: ${night ? "#0d0a1a" : "#fbf6ec"}; --dot: ${night ? "rgba(196,181,253,0.16)" : "rgba(27,20,51,0.13)"}; --gap: 30px; }
    .glow { position: absolute; inset: 0; background:
      radial-gradient(520px 420px at 50% 78%, ${night ? "rgba(255,122,61,0.30)" : "rgba(255,122,61,0.22)"}, transparent 70%),
      radial-gradient(420px 380px at 18% 12%, rgba(169,141,255,${night ? 0.22 : 0.18}), transparent 70%); }
    .ring { position: absolute; left: 90px; top: 90px; width: 820px; height: 820px; border-radius: 50%; border: 3px dashed ${night ? "rgba(196,181,253,0.22)" : "rgba(27,20,51,0.18)"}; }
    .bug { position: absolute; left: 192px; top: 186px; transform: rotate(-11deg); filter: drop-shadow(0 30px 30px ${night ? "rgba(0,0,0,0.45)" : "rgba(27,20,51,0.16)"}); }
    .tag { position: absolute; left: 700px; top: 210px; }
    .spark { position: absolute; left: 230px; top: 250px; }
    .braces { position: absolute; left: 640px; top: 690px; }
  </style></head><body><div class="pp dots" id="shot">
    <div class="glow"></div><div class="ring"></div>
    <div class="tag">${tag}</div><div class="spark">${spark}</div><div class="braces">${braces}</div>
    <div class="bug">${bug}</div>
  </div></body></html>`;
}

// ── header banner, 3:1 ────────────────────────────────────────────────────────────────────
// X puts the profile picture over the bottom-left on every screen, so the left quarter stays quiet.
function banner() {
  const pal = NIGHT;
  const bug = svg(h(Bug, { x: 60, y: 60, size: 120, face: "joy", open: 16, shadow: false, sw: 3 }), pal, "-4 -6 128 132", 'width="400" height="410"');
  const tag = svg(h(CodeTag, { x: 20, y: 20, s: 30, sw: 1.5, color: "var(--sky)", rot: -10 }), pal, "0 0 40 40", 'width="130" height="130"');
  const spark = (c, s) => svg(h(Sparkle, { x: 20, y: 20, s: 13, sw: 2.2, color: `var(--${c})` }), pal, "0 0 40 40", `width="${s}" height="${s}"`);
  // the git graph: from the bug's shell, a trunk forks into branches that end in commits (pills)
  const devs = [
    { x: 1540, label: "@you", pct: "40%", c: "#66c7ff" },
    { x: 1900, label: "@fav-dev", pct: "30%", c: "#ff8ccf" },
    { x: 2260, label: "@maintainer", pct: "20%", c: "#ffd45c" },
    { x: 2620, label: "splitdev", pct: "10%", c: "#ff7a3d" },
  ];
  const trunkX = 2620, forkY = 470, endY = 760;
  // a point along a branch (0 = the fork, 1 = the commit): drops ride the actual curves
  const along = (d, u) => {
    const m = 1 - u, y0 = forkY, y3 = forkY + 200;
    return [m * m * m * trunkX + 3 * m * m * u * trunkX + 3 * m * u * u * d.x + u * u * u * d.x, m * m * m * y0 + 3 * m * m * u * (forkY + 120) + 3 * m * u * u * (forkY + 80) + u * u * u * y3];
  };
  const branch = (d) => `M${trunkX} 390 V${forkY} C${trunkX} ${forkY + 120} ${d.x} ${forkY + 80} ${d.x} ${forkY + 200} V${endY}`;
  const graph = `<svg class="graph" width="3000" height="1000" viewBox="0 0 3000 1000">
    ${devs.map((d) => `<path d="${branch(d)}" fill="none" stroke="${d.c}" stroke-opacity="0.22" stroke-width="22" stroke-linecap="round"/>
      <path d="${branch(d)}" fill="none" stroke="${d.c}" stroke-width="6" stroke-linecap="round" stroke-dasharray="10 22"/>
      <circle cx="${d.x}" cy="${forkY + 200}" r="15" fill="#15112a" stroke="${d.c}" stroke-width="7"/>`).join("")}
    <circle cx="${trunkX}" cy="${forkY}" r="20" fill="#ff7a3d" stroke="#130d26" stroke-width="5"/>
    ${devs.flatMap((d, i) => [0.42 + i * 0.05, 0.8].map((u) => along(d, u)).map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="${d.c}" stroke="#130d26" stroke-width="5"/>`)).join("")}
  </svg>`;
  const pills = devs
    .map((d) => `<div class="pill mono" style="left:${d.x}px;--c:${d.c}"><span class="who">${d.label}</span><span class="pct">${d.pct}</span></div>`)
    .join("");
  return `<!doctype html><html><head><style>${base}
    .banner { position: relative; width: 3000px; height: 1000px; overflow: hidden; background-color: #0d0a1a; --dot: rgba(196,181,253,0.12); --gap: 36px; color: #f6f1ff; }
    .glow { position: absolute; inset: 0; background:
      radial-gradient(900px 600px at 86% 30%, rgba(255,122,61,0.26), transparent 70%),
      radial-gradient(1000px 700px at 30% -10%, rgba(169,141,255,0.20), transparent 70%),
      radial-gradient(900px 500px at 55% 120%, rgba(61,220,151,0.10), transparent 70%); }
    .graph { position: absolute; inset: 0; }
    .bug { position: absolute; left: 2420px; top: 24px; filter: drop-shadow(0 26px 28px rgba(0,0,0,0.5)); }
    .copy { position: absolute; left: 860px; top: 150px; }
    .eyebrow { font-size: 40px; color: #9087b0; letter-spacing: 0.04em; }
    .eyebrow b { color: #ff7a3d; font-weight: 600; }
    h1 { font-family: "Space Grotesk", sans-serif; font-weight: 700; font-size: 168px; line-height: 0.98; letter-spacing: -0.045em; margin-top: 34px; }
    h1 .accent { color: #ff7a3d; font-size: 1.04em; letter-spacing: -0.02em; }
    .url { position: absolute; left: 860px; top: 780px; font-size: 46px; color: #f6f1ff; display: flex; align-items: center; gap: 22px; }
    .url .key { font-size: 30px; padding: 10px 20px 12px; border-radius: 16px; background: #ff7a3d; color: #1c0c04; font-weight: 700; box-shadow: 0 8px 0 #c94a14; }
    .url .caret { display: inline-block; width: 26px; height: 7px; background: #ff7a3d; margin-left: 6px; transform: translateY(14px); }
    .pill { position: absolute; top: 800px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; font-size: 31px;
      padding: 12px 14px 12px 24px; border-radius: 999px; background: #15112a; border: 3px solid rgba(196,181,253,0.18); white-space: nowrap; }
    .pill .who { color: #f6f1ff; }
    .pill .pct { background: var(--c); color: #130d26; font-weight: 700; padding: 4px 16px; border-radius: 999px; }
    .tag { position: absolute; left: 2830px; top: 520px; }
    .s1 { position: absolute; left: 2240px; top: 140px; } .s2 { position: absolute; left: 720px; top: 120px; } .s3 { position: absolute; left: 1960px; top: 330px; }
    .foot { position: absolute; right: 70px; bottom: 44px; font-size: 26px; color: #9087b0; }
  </style></head><body><div class="banner dots" id="shot">
    <div class="glow"></div>
    ${graph}
    <div class="bug">${bug}</div>
    <div class="tag">${tag}</div>
    <div class="s1">${spark("sun", 90)}</div><div class="s2">${spark("pink", 70)}</div><div class="s3">${spark("lilac", 56)}</div>
    <div class="copy">
      <div class="eyebrow mono"><b>//</b> launch a pump.fun coin · split its fees for good</div>
      <h1>Coins that pay<br/><span class="accent squiggle">GitHub</span> devs.</h1>
    </div>
    <div class="url mono"><span class="key">$</span>splitdev.app<span class="caret"></span></div>
    ${pills}
    <div class="foot mono">solana · pump.fun · not affiliated with pump.fun or GitHub</div>
  </div></body></html>`;
}

const { chromium } = await import(join(root, "e2e/node_modules/playwright/index.mjs"));
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
async function shoot(html, file, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.locator("#shot").screenshot({ path: join(OUT, file) });
  await page.close();
}
await shoot(pp("night"), "pp-night.png", 1000, 1000);
await shoot(pp("day"), "pp-day.png", 1000, 1000);
await shoot(banner(), "banner.png", 3000, 1000);
await browser.close();
console.log("wrote", OUT);
