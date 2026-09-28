import { readFileSync } from "fs";
import { getContractAddress, isAddress, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Zero-config addresses: a fresh admin key deploys FeeVault with nonce 0 and SplitLaunchpad with
 * nonce 1 (see /setup), so both addresses are known at build time from the key alone. Explicit
 * NEXT_PUBLIC_* variables or addresses committed to src/deployment.json for this network take
 * precedence ("pinned"), and should be set once contracts are live so the signing key can be
 * rotated without moving the site.
 */
// Must match normalizeKey() / adminKey() in src/lib/adminKey.ts.
function normalizeKey(raw) {
  const v = raw.trim();
  const k = /^0x/i.test(v) ? `0x${v.slice(2)}` : `0x${v}`;
  return /^0x[0-9a-fA-F]{64}$/.test(k) ? k : null;
}

function adminKeyFromEnv() {
  const raw = process.env.SIGNER_PRIVATE_KEY;
  if (raw && raw.trim()) {
    const key = normalizeKey(raw);
    // Fail the build loudly: a typo here would otherwise silently point the site at nothing.
    if (!key) throw new Error("SIGNER_PRIVATE_KEY is set but isn't a 32-byte hex private key (64 hex characters, optionally 0x-prefixed).");
    return key;
  }
  if (process.env.SIGNER_SEED) return keccak256(toBytes(`ponsplit-admin:${process.env.SIGNER_SEED}`));
  return undefined;
}

/** A pinned address must be exactly 0x + 40 hex characters; anything else fails the build. */
function checkAddress(value, name) {
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${name} is set but isn't an address: use 0x followed by 40 hex characters, with no quotes, spaces or "NAME=" prefix.`);
  }
}

function predictedAddresses() {
  // Pinning is all or nothing: with only one address set, the app would find its launchpad but not
  // its vault, and signing would quietly switch off.
  const pinnedVault = Boolean(process.env.NEXT_PUBLIC_FEE_VAULT_ADDRESS);
  const pinnedLaunchpad = Boolean(process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS);
  if (pinnedVault !== pinnedLaunchpad) {
    throw new Error("Set both NEXT_PUBLIC_FEE_VAULT_ADDRESS and NEXT_PUBLIC_LAUNCHPAD_ADDRESS, or neither.");
  }
  if (pinnedVault) {
    checkAddress(process.env.NEXT_PUBLIC_FEE_VAULT_ADDRESS, "NEXT_PUBLIC_FEE_VAULT_ADDRESS");
    checkAddress(process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS, "NEXT_PUBLIC_LAUNCHPAD_ADDRESS");
  }
  const deployment = JSON.parse(readFileSync(new URL("./src/deployment.json", import.meta.url), "utf8"));
  const key = adminKeyFromEnv();
  const chain = process.env.NEXT_PUBLIC_CHAIN || "testnet";
  const entry = deployment[chain] ?? {};
  if (Boolean(entry.launchpad) !== Boolean(entry.feeVault)) throw new Error(`src/deployment.json: set both launchpad and feeVault for "${chain}", or neither.`);
  if (entry.launchpad) {
    checkAddress(entry.feeVault, `src/deployment.json ${chain}.feeVault`);
    checkAddress(entry.launchpad, `src/deployment.json ${chain}.launchpad`);
  }
  const committed = Boolean(entry.launchpad);
  if (committed || process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS || !key) return {};
  const admin = privateKeyToAccount(key).address;
  return {
    NEXT_PUBLIC_FEE_VAULT_ADDRESS: getContractAddress({ from: admin, nonce: 0n }),
    NEXT_PUBLIC_LAUNCHPAD_ADDRESS: getContractAddress({ from: admin, nonce: 1n }),
    NEXT_PUBLIC_ADDRESSES_PREDICTED: "1",
  };
}

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
  env: predictedAddresses(),
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
