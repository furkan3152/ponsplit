// Read-only check of a live SplitEarn deployment, straight from the chain (no server, no key):
// contract code, wiring, the pons factory it launches on, signer, owners and launch terms. Exits
// non-zero if anything is inconsistent.
//
//   NETWORK=testnet|mainnet LAUNCHER=0x... [OWNER=0x...] [SIGNER=0x...] \
//     node --experimental-strip-types scripts/inspect-deployment.mjs
//
// OWNER checks who owns the contracts (the wallet that deployed them from /setup); SIGNER checks
// the FeeVault trusts the site's signing key (its address is public: /api/config shows it).
import { createPublicClient, formatEther, getAddress, http, isAddressEqual } from "viem";
import { feeVaultAbi, launcherAbi, ponsFactoryAbi } from "../src/lib/abi.ts";

const NETWORKS = {
  testnet: { id: 46630, rpc: "https://rpc.testnet.chain.robinhood.com", pons: undefined },
  mainnet: { id: 4663, rpc: "https://rpc.mainnet.chain.robinhood.com", pons: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" },
};
const net = NETWORKS[process.env.NETWORK || "testnet"];
if (!net) throw new Error(`NETWORK must be one of ${Object.keys(NETWORKS).join(", ")}`);
const launcher = getAddress(process.env.LAUNCHER ?? "");
const owner = process.env.OWNER ? getAddress(process.env.OWNER) : undefined;
const expectedSigner = process.env.SIGNER ? getAddress(process.env.SIGNER) : undefined;

const client = createPublicClient({ transport: http(process.env.RPC_URL || net.rpc) });
const problems = [];
const check = (ok, what) => {
  console.log(`${ok ? "✔" : "✘"} ${what}`);
  if (!ok) problems.push(what);
};
const hasCode = async (address) => {
  const code = await client.getCode({ address });
  return code && code !== "0x" ? (code.length - 2) / 2 : 0;
};

const chainId = await client.getChainId();
check(chainId === net.id, `chain id ${chainId}`);
const launcherBytes = await hasCode(launcher);
check(launcherBytes > 0, `launcher ${launcher} has code (${launcherBytes} bytes)`);

const l = (functionName, args) => client.readContract({ address: launcher, abi: launcherAbi, functionName, args });
const [vault, factory, router] = await Promise.all([l("feeVault"), l("ponsFactory"), l("router")]);
console.log(`  FeeVault               ${vault}`);
console.log(`  pons factory           ${factory}${net.pons ? "" : " (SplitEarn's copy)"}`);
console.log(`  router                 ${router}`);
if (net.pons) check(isAddressEqual(factory, net.pons), "the launcher launches on the real pons factory");
check((await hasCode(vault)) > 0, "FeeVault has code");
check((await hasCode(factory)) > 0, "the pons factory has code");

const v = (functionName, args) => client.readContract({ address: vault, abi: feeVaultAbi, functionName, args });
const f = (functionName, args) => client.readContract({ address: factory, abi: ponsFactoryAbi, functionName, args });
check(await v("isLauncher", [launcher]), "FeeVault accepts the launcher's splits");
const signer = await v("signer");
if (expectedSigner) check(isAddressEqual(signer, expectedSigner), `FeeVault trusts the site's signing key (${signer})`);
else console.log(`  FeeVault.signer        ${signer}`);

const [vOwner, vPending, lOwner, lPending] = await Promise.all([v("owner"), v("pendingOwner"), l("owner"), l("pendingOwner")]);
console.log(`  FeeVault owner         ${vOwner}${/^0x0+$/.test(vPending) ? "" : ` (pending ${vPending})`}`);
console.log(`  launcher owner         ${lOwner}${/^0x0+$/.test(lPending) ? "" : ` (pending ${lPending})`}`);
if (owner) check(isAddressEqual(vOwner, owner) && isAddressEqual(lOwner, owner), `both are owned by ${owner}`);
if (!net.pons && owner) check(isAddressEqual(await f("owner"), owner), `the pons copy is owned by ${owner}`);

const [version, share, configId, launchFee, , maxTax, canLaunch, paused] = await l("launchTerms");
const [count, platformFees, totalPlatformFees] = await Promise.all([l("launchCount"), l("platformFees"), l("totalPlatformFees")]);
const [claimsPaused, totalDeposited] = await Promise.all([v("claimsPaused"), v("totalDeposited")]);
console.log(`  terms                  version ${version}, SplitEarn ${share / 100}% of the creator fee, pons config ${configId}, max creator tax ${Number(maxTax) / 100}%`);
console.log(`  pons launch fee        ${formatEther(launchFee)} ETH`);
console.log(`  coins                  ${count}`);
console.log(`  split to X accounts    ${formatEther(totalDeposited)} ETH`);
console.log(`  SplitEarn's share       ${formatEther(platformFees)} ETH to withdraw, ${formatEther(totalPlatformFees)} ETH in all`);
check(canLaunch, "pons accepts launches from the launcher");
check(!paused, "SplitEarn launches are open");
check(!claimsPaused, "claims are open");

if (problems.length) {
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log("\nDeployment looks consistent.");
