// Bundles the site's Solana code (src/lib/solana) into one CommonJS file for the Node test scripts:
// pump.fun's SDKs only load under Node through CommonJS, as the Next bundle loads them.
import { build } from "esbuild";

await build({
  entryPoints: { lib: "src/lib/solana/index.ts" },
  outdir: "e2e/solana/.build",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  outExtension: { ".js": ".cjs" },
  logLevel: "warning",
});
