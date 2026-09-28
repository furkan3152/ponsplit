// Renders the brand mark (src/components/art/Logo.tsx) to static SVG files with literal colors,
// for places that can't use the app's CSS variables: the favicon, the home-screen icon and
// share cards.   node scripts/render-logo.mjs
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { transform } from "sucrase";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "node_modules", ".cache", "logo");
mkdirSync(out, { recursive: true });
for (const f of ["parts", "Logo"]) {
  const src = readFileSync(join(root, "src/components/art", `${f}.tsx`), "utf8");
  const { code } = transform(src, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true });
  writeFileSync(join(out, `${f}.cjs`), code.replace(/require\(['"]\.\/(\w+)['"]\)/g, 'require("./$1.cjs")'));
}
const { createRequire } = await import("module");
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { LogoMark } = require(join(out, "Logo.cjs"));

// The dark theme's values (globals.css); the outline is the stickers' ink.
const colors = { lime: "#ccff00", green: "#3ee07f", sun: "#ffd84d", pink: "#ff93c9", outline: "#0b0b0d", shine: "#ffffff" };
let svg = renderToStaticMarkup(React.createElement(LogoMark, { size: 64 }));
svg = svg.replace(/var\(--(\w+)(?:,\s*[^)]+)?\)/g, (m, name) => colors[name] ?? m);
if (svg.includes("var(")) throw new Error(`unresolved color in ${svg}`);
svg = svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/ aria-hidden="true"| focusable="false"/g, "");
writeFileSync(join(root, "public/logo.svg"), svg + "\n");
writeFileSync(join(root, "src/app/icon.svg"), svg + "\n");
console.log(svg.length, "bytes");
