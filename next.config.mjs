import { readFileSync } from "fs";
import { isAddress } from "viem";

/**
 * Checks what pins the site to its contracts on each network before building: the addresses in
 * src/deployment.json and the NEXT_PUBLIC_<NETWORK>_* variables that override them. A malformed or
 * half-set pin fails the build instead of quietly pointing the site at nothing.
 */
function checkAddress(value, name) {
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${name} is set but isn't an address: use 0x followed by 40 hex characters, with no quotes, spaces or "NAME=" prefix.`);
  }
}

function checkPins() {
  const deployment = JSON.parse(readFileSync(new URL("./src/deployment.json", import.meta.url), "utf8"));
  for (const network of ["mainnet", "testnet"]) {
    const NET = network.toUpperCase();
    const entry = deployment[network] ?? {};
    const launcher = process.env[`NEXT_PUBLIC_${NET}_LAUNCHER_ADDRESS`] || entry.launcher;
    const feeVault = process.env[`NEXT_PUBLIC_${NET}_FEE_VAULT_ADDRESS`] || entry.feeVault;
    // All or nothing: with only one of them the site would find its launcher but not its vault.
    if (Boolean(launcher) !== Boolean(feeVault)) {
      throw new Error(`${network}: pin both the launcher and the FeeVault address (src/deployment.json or NEXT_PUBLIC_${NET}_* variables), or neither.`);
    }
    if (launcher) {
      checkAddress(launcher, `${network} launcher`);
      checkAddress(feeVault, `${network} FeeVault`);
    }
    const factory = network === "testnet" ? process.env.NEXT_PUBLIC_TESTNET_PONS_FACTORY || entry.ponsFactory : undefined;
    if (factory) checkAddress(factory, "testnet ponsFactory");
    if (entry.hidden !== undefined && !Array.isArray(entry.hidden)) throw new Error(`src/deployment.json: ${network}.hidden must be a list of coin addresses.`);
    (entry.hidden ?? []).forEach((a, i) => checkAddress(a, `src/deployment.json ${network}.hidden[${i}]`));
    if (entry.officialToken) checkAddress(entry.officialToken, `src/deployment.json ${network}.officialToken`);
    if (entry.previousLaunchers !== undefined && !Array.isArray(entry.previousLaunchers))
      throw new Error(`src/deployment.json: ${network}.previousLaunchers must be a list of launcher addresses.`);
    (entry.previousLaunchers ?? []).forEach((a, i) => checkAddress(a, `src/deployment.json ${network}.previousLaunchers[${i}]`));
    (process.env[`NEXT_PUBLIC_${NET}_HIDDEN_COINS`] || "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
      .forEach((a, i) => checkAddress(a, `NEXT_PUBLIC_${NET}_HIDDEN_COINS entry ${i + 1}`));
  }
  const fallback = process.env.NEXT_PUBLIC_DEFAULT_NETWORK;
  if (fallback && fallback !== "mainnet" && fallback !== "testnet") throw new Error('NEXT_PUBLIC_DEFAULT_NETWORK must be "mainnet" or "testnet".');
}

checkPins();

const X402_MODULES = [
  "@x402/core/client",
  "@x402/core/schemas",
  "@x402/core/server",
  "@x402/evm",
  "@x402/evm/auth-capture/client",
  "@x402/evm/batch-settlement/client",
  "@x402/evm/exact/client",
  "@x402/evm/exact/server",
  "@x402/evm/exact/v1/client",
  "@x402/evm/upto/client",
  "@x402/evm/upto/server",
  "@x402/express",
  "@x402/extensions/bazaar",
  "@x402/extensions/builder-code",
  "@x402/fetch",
  "@x402/svm/exact/client",
  "@x402/svm/exact/server",
  "@x402/svm/exact/v1/client",
  "@x402/svm/upto/client",
  "@x402/svm/upto/server",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
    // Optional deps pulled in by WalletConnect / MetaMask SDK that are not needed in the browser.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.fallback = { ...config.resolve.fallback, "@react-native-async-storage/async-storage": false };
    // x402 payment helpers are optional peers of the Base Account connector's CDP SDK; the app never uses them.
    config.resolve.alias = { ...config.resolve.alias, ...Object.fromEntries(X402_MODULES.map((m) => [m, false])) };
    return config;
  },
};

export default nextConfig;
