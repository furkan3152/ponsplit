import { readFileSync } from "fs";

/**
 * Checks src/splidev.json before building: a malformed treasury, hidden coin or official token,
 * or a platform share outside pump.fun's limits, fails the build instead of quietly breaking launches.
 */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function checkKey(value, name) {
  if (!BASE58.test(String(value))) throw new Error(`${name} isn't a Solana address (base58, 32-44 characters, no quotes or spaces).`);
}

function checkSettings() {
  const s = JSON.parse(readFileSync(new URL("./src/splidev.json", import.meta.url), "utf8"));
  const deployment = JSON.parse(readFileSync(new URL("./src/tiktok-deployment.json", import.meta.url), "utf8"));
  const artifact = JSON.parse(readFileSync(new URL("./public/programs/tiktok-escrow.manifest.json", import.meta.url), "utf8"));
  checkKey(deployment.programId, "src/tiktok-deployment.json programId");
  checkKey(deployment.programData, "src/tiktok-deployment.json programData");
  checkKey(deployment.upgradeAuthority, "src/tiktok-deployment.json upgradeAuthority");
  if (deployment.network !== "mainnet-beta" || deployment.upgradeAuthority !== s.treasury || deployment.artifactSha256 !== artifact.sha256) {
    throw new Error("The public mainnet deployment must match the admin treasury and pinned escrow artifact.");
  }
  const treasury = process.env.NEXT_PUBLIC_SPLIDEV_TREASURY || s.treasury;
  if (treasury) checkKey(treasury, "src/splidev.json treasury");
  const bps = Number(process.env.NEXT_PUBLIC_SPLIDEV_PLATFORM_BPS || s.platformBps);
  if (!Number.isInteger(bps) || bps < 0 || bps > 5000) throw new Error("src/splidev.json platformBps must be a whole number of basis points from 0 to 5000.");
  const fee = String(process.env.NEXT_PUBLIC_SPLIDEV_LAUNCH_FEE_SOL ?? s.launchFeeSol);
  if (!/^\d+(\.\d{1,9})?$/.test(fee)) throw new Error('src/splidev.json launchFeeSol must be a SOL amount like "0.01".');
  if (!Array.isArray(s.hidden)) throw new Error("src/splidev.json hidden must be a list of mint addresses.");
  s.hidden.forEach((m, i) => checkKey(m, `src/splidev.json hidden[${i}]`));
  if (s.officialToken) checkKey(s.officialToken, "src/splidev.json officialToken");
  for (const name of ["NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID", "NEXT_PUBLIC_TIKSPLIT_VERIFIER"]) {
    if (process.env[name]) checkKey(process.env[name], name);
  }
}

checkSettings();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    outputFileTracingIncludes: {
      "/api/admin/status": ["./public/programs/tiktok-escrow.so"],
      "/api/admin/configuration": ["./public/programs/tiktok-escrow.so"],
      "/api/tiktok/verify": ["./public/programs/tiktok-escrow.so"],
      "/api/runtime-status": ["./public/programs/tiktok-escrow.so"],
      "/api/solana/accounts": ["./public/programs/tiktok-escrow.so"],
      "/api/metadata": ["./public/programs/tiktok-escrow.so"],
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
  webpack: (config) => {
    // Optional dependencies of the Solana libraries that the browser doesn't need.
    config.externals.push("pino-pretty", "encoding");
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, os: false, path: false };
    return config;
  },
};

export default nextConfig;
