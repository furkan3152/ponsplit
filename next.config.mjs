import { readFileSync } from "fs";
import { getContractAddress, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Zero-config addresses: a fresh admin key deploys FeeVault with nonce 0 and SplitLaunchpad with
 * nonce 1 (see /setup), so both addresses are known at build time from the key alone. Explicit
 * NEXT_PUBLIC_* variables or addresses committed to src/deployment.json take precedence.
 */
// Must match src/lib/adminKey.ts.
function adminKeyFromEnv() {
  if (process.env.SIGNER_PRIVATE_KEY) return process.env.SIGNER_PRIVATE_KEY;
  if (process.env.SIGNER_SEED) return keccak256(toBytes(`ponsplit-admin:${process.env.SIGNER_SEED}`));
  return undefined;
}

function predictedAddresses() {
  const deployment = JSON.parse(readFileSync(new URL("./src/deployment.json", import.meta.url), "utf8"));
  const key = adminKeyFromEnv();
  const chain = process.env.NEXT_PUBLIC_CHAIN || deployment.chain;
  const committed = deployment.chain === chain && deployment.launchpad;
  if (committed || process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS || !key) return {};
  try {
    const admin = privateKeyToAccount(key).address;
    return {
      NEXT_PUBLIC_FEE_VAULT_ADDRESS: getContractAddress({ from: admin, nonce: 0n }),
      NEXT_PUBLIC_LAUNCHPAD_ADDRESS: getContractAddress({ from: admin, nonce: 1n }),
    };
  } catch {
    return {};
  }
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
