// Read-only check of a live deployment, straight from the chain (no server, no key): contract code,
// wiring, signer, owners and launch terms. Exits non-zero if anything is inconsistent.
//
//   NETWORK=testnet VAULT=0x... LAUNCHPAD=0x... [ADMIN=0x...] \
//     node --experimental-strip-types scripts/inspect-deployment.mjs
//
// ADMIN (the address /setup shows) also checks that the contracts are the ones that key deployed
// at nonces 0 and 1, i.e. the addresses the site predicts.
import { createPublicClient, formatEther, getAddress, getContractAddress, http, isAddressEqual } from "viem";
import { feeVaultAbi, launchpadAbi } from "../src/lib/abi.ts";

const NETWORKS = {
  testnet: { id: 46630, rpc: "https://rpc.testnet.chain.robinhood.com" },
  mainnet: { id: 4663, rpc: "https://rpc.mainnet.chain.robinhood.com" },
};
const net = NETWORKS[process.env.NETWORK || "testnet"];
if (!net) throw new Error(`NETWORK must be one of ${Object.keys(NETWORKS).join(", ")}`);
const vault = getAddress(process.env.VAULT ?? "");
const launchpad = getAddress(process.env.LAUNCHPAD ?? "");
const admin = process.env.ADMIN ? getAddress(process.env.ADMIN) : undefined;

const client = createPublicClient({ transport: http(process.env.RPC_URL || net.rpc) });
const problems = [];
const check = (ok, what) => {
  console.log(`${ok ? "✔" : "✘"} ${what}`);
  if (!ok) problems.push(what);
};

const chainId = await client.getChainId();
check(chainId === net.id, `chain id ${chainId}`);
for (const [name, address] of [["FeeVault", vault], ["SplitLaunchpad", launchpad]]) {
  const code = await client.getCode({ address });
  check(Boolean(code && code !== "0x"), `${name} ${address} has code (${code ? (code.length - 2) / 2 : 0} bytes)`);
}
if (admin) {
  check(isAddressEqual(getContractAddress({ from: admin, nonce: 0n }), vault), `FeeVault is ${admin}'s nonce-0 contract`);
  check(isAddressEqual(getContractAddress({ from: admin, nonce: 1n }), launchpad), `SplitLaunchpad is ${admin}'s nonce-1 contract`);
}

const v = (functionName, args) => client.readContract({ address: vault, abi: feeVaultAbi, functionName, args });
const l = (functionName, args) => client.readContract({ address: launchpad, abi: launchpadAbi, functionName, args });

check(isAddressEqual(await v("launchpad"), launchpad), "FeeVault.launchpad points at the launchpad");
check(isAddressEqual(await l("vault"), vault), "SplitLaunchpad.vault points at the vault");
const signer = await v("signer");
if (admin) check(isAddressEqual(signer, admin), `FeeVault.signer is the admin (${signer})`);
else console.log(`  FeeVault.signer        ${signer}`);

const [vOwner, vPending, lOwner, lPending] = await Promise.all([v("owner"), v("pendingOwner"), l("owner"), l("pendingOwner")]);
console.log(`  FeeVault owner         ${vOwner}${/^0x0+$/.test(vPending) ? "" : ` (pending ${vPending})`}`);
console.log(`  SplitLaunchpad owner   ${lOwner}${/^0x0+$/.test(lPending) ? "" : ` (pending ${lPending})`}`);

const [feeBps, protocolShareBps, graduationFeeBps, creationFee, termsVersion, launchesPaused, tokenCount, trades] = await Promise.all([
  l("feeBps"),
  l("protocolShareBps"),
  l("graduationFeeBps"),
  l("creationFee"),
  l("termsVersion"),
  l("launchesPaused"),
  l("tokenCount"),
  l("globalTradeCount"),
]);
const [claimsPaused, totalDeposited] = await Promise.all([v("claimsPaused"), v("totalDeposited")]);
console.log(`  fee                    ${Number(feeBps) / 100}% (protocol ${Number(protocolShareBps) / 100}% of it), graduation ${Number(graduationFeeBps) / 100}%`);
console.log(`  creation fee           ${formatEther(creationFee)} ETH, terms version ${termsVersion}`);
console.log(`  coins / trades         ${tokenCount} / ${trades}`);
console.log(`  fees paid into vault   ${formatEther(totalDeposited)} ETH`);
check(!launchesPaused, "launches are open");
check(!claimsPaused, "claims are open");

if (problems.length) {
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log("\nDeployment looks consistent.");
