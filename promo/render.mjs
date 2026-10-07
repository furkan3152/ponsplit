// Renders promo/promo.html to an MP4: Bitbug poses come from src/components/art/Bug.tsx (rendered to
// SVG with the dark theme's colors), Chromium draws every frame, ffmpeg encodes it with a soft
// synthesized soundtrack.
//
//   FFMPEG=/path/to/ffmpeg OUT=out.mp4 node promo/render.mjs            # the video
//   FFMPEG=… STILLS=3,12,20 OUTDIR=dir node promo/render.mjs            # PNG stills at those seconds
// Needs the e2e Playwright install (cd e2e && npm ci) and an ffmpeg with libx264 (e.g. ffmpeg-static).
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { execFileSync, spawn } from "child_process";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { transform } from "sucrase";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const FPS = Number(process.env.FPS || 60);
const FFMPEG = process.env.FFMPEG || "ffmpeg";

// ── Bitbug as static SVG ──────────────────────────────────────────────────────────────────
const cache = join(root, "node_modules", ".cache", "promo");
mkdirSync(cache, { recursive: true });
for (const f of ["parts", "Bug"]) {
  const src = readFileSync(join(root, "src/components/art", `${f}.tsx`), "utf8");
  const { code } = transform(src, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true });
  writeFileSync(join(cache, `${f}.cjs`), code.replace(/require\(['"]\.\/(\w+)['"]\)/g, 'require("./$1.cjs")'));
}
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { Bug } = require(join(cache, "Bug.cjs"));
const colors = { lime: "#ff7a3d", green: "#3ddc97", sun: "#ffd45c", pink: "#ff8ccf", lilac: "#a98dff", sky: "#66c7ff", outline: "#130d26", shine: "#ffffff", "bug-limb": "#8d82b8" };
function bugSvg(props) {
  const g = renderToStaticMarkup(React.createElement(Bug, { x: 60, y: 58, size: 120, shadow: false, sw: 3, ...props }));
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="620" viewBox="0 -4 120 124">${g}</svg>`;
  svg = svg.replace(/var\(--([\w-]+)(?:,\s*[^)]+)?\)/g, (m, name) => colors[name] ?? m);
  if (svg.includes("var(")) throw new Error("unresolved color in the bug");
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}
const BUGS = { closed: bugSvg({ face: "happy" }), open: bugSvg({ face: "joy", open: 24 }) };
// Fonts and avatars are fetched here (curl honours the proxy) and inlined, so the page needs no network.
const curl = (url, ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Chrome/141 Safari/537.36") =>
  execFileSync("curl", ["-sSL", "-m", "30", "-A", ua, url], { maxBuffer: 64 << 20 });
const dataUrl = (buf, type) => `data:${type};base64,${buf.toString("base64")}`;
let FONT_CSS = curl("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=JetBrains+Mono:wght@400;600;700&family=Figtree:wght@400;500;600;700&family=Fraunces:ital,opsz,wght@1,9..144,600&display=block").toString();
for (const u of new Set(FONT_CSS.match(/https:[^)]+\.woff2/g) || [])) FONT_CSS = FONT_CSS.split(u).join(dataUrl(curl(u), "font/woff2"));
const AVATARS = {
  torvalds: dataUrl(curl("https://avatars.githubusercontent.com/u/1024025?s=200"), "image/png"),
  gaearon: dataUrl(curl("https://avatars.githubusercontent.com/u/810438?s=200"), "image/png"),
};

// ── frames ───────────────────────────────────────────────────────────────────────────────
const { chromium } = await import(join(root, "e2e/node_modules/playwright/index.mjs"));
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript(({ BUGS, AVATARS }) => Object.assign(window, { BUGS, AVATARS }), { BUGS, AVATARS });
await page.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
await page.goto("file://" + join(root, "promo/promo.html"));
await page.evaluate(() => Promise.all(["700 40px 'Space Grotesk'", "600 40px 'JetBrains Mono'", "400 40px 'JetBrains Mono'", "500 40px Figtree", "700 40px Figtree", "italic 600 40px Fraunces"].map((f) => document.fonts.load(f))));
await page.evaluate(() => window.SETUP);
const duration = await page.evaluate(() => window.DURATION);
const shot = () => page.screenshot({ type: "jpeg", quality: 94, clip: { x: 0, y: 0, width: 1920, height: 1080 } });

if (process.env.STILLS) {
  const dir = process.env.OUTDIR || ".";
  mkdirSync(dir, { recursive: true });
  for (const s of process.env.STILLS.split(",").map(Number)) {
    await page.evaluate((t) => window.renderFrame(t), s);
    writeFileSync(join(dir, `still-${String(s).padStart(5, "0")}.jpg`), await shot());
  }
  await browser.close();
  process.exit(0);
}

const out = process.env.OUT || "splidev-promo.mp4";
const video = out.replace(/\.mp4$/, ".video.mp4");
const ff = process.env.AUDIO_ONLY ? { stdin: { end() {}, write: () => true } } : spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video], { stdio: ["pipe", "inherit", "inherit"] });
const frames = process.env.AUDIO_ONLY ? 0 : Math.round(duration * FPS); // AUDIO_ONLY=1 reuses the rendered .video.mp4
for (let f = 0; f < frames; f++) {
  await page.evaluate((t) => window.renderFrame(t), f / FPS);
  const buf = await shot();
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % (FPS * 5) === 0) console.log(`frame ${f}/${frames}`);
}
ff.stdin.end();
if (!process.env.AUDIO_ONLY) await new Promise((r, j) => ff.on("close", (c) => (c ? j(new Error(`ffmpeg ${c}`)) : r())));
await browser.close();

// ── soundtrack: a soft pad (A minor 9), a low pulse, and a blip on every scene change ────
const cuts = [2.6, 7.2, 11.6, 14.2, 16.4, 23.4, 31.2, 36.2, 41.2, 46.2];
const blip = cuts.map((c) => `if(gte(t,${c})*lt(t,${c + 0.35}),0.10*sin(2*PI*1320*t)*exp(-14*(t-${c})),0)`).join("+");
const pad = "0.045*(sin(2*PI*110*t)+0.8*sin(2*PI*164.81*t)+0.7*sin(2*PI*261.63*t)+0.55*sin(2*PI*329.63*t)+0.4*sin(2*PI*493.88*t))*(0.75+0.25*sin(2*PI*0.12*t))";
const pulse = "0.16*sin(2*PI*55*t)*exp(-7*mod(t,0.6))*gte(t,2.6)*lt(t,46.2)";
const expr = `(${pad}+${pulse}+${blip})*min(1,t/2)*min(1,(${duration}-t)/2)`;
await new Promise((r, j) =>
  spawn(FFMPEG, ["-y", "-loglevel", "error", "-i", video, "-f", "lavfi", "-i", `aevalsrc='${expr}|${expr}':s=48000:d=${duration}`, "-af", "lowpass=f=3200,aecho=0.6:0.5:180:0.25,volume=13dB,alimiter=limit=0.89", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out], { stdio: "inherit" }).on("close", (c) => (c ? j(new Error(`ffmpeg ${c}`)) : r()))
);
console.log("wrote", out);
