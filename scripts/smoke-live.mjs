// Read-only launch check against a live site. The site's /api/attest resolves real X accounts and
// signs an attestation with the server key, exactly as for a real launch; the attestation is then
// used to simulate PonsEarnLauncher.launch on the live contracts with eth_call (with and without a
// first buy). Nothing is sent and no key is needed.
//
//   SITE=https://... NETWORK=testnet|mainnet LAUNCHER=0x... [HANDLES=jack,x] \
//     node --experimental-strip-types scripts/smoke-live.mjs
import { createPublicClient, formatEther, getAddress, http, parseEther, toHex } from "viem";
import { feeVaultAbi, launcherAbi, ponsFactoryAbi } from "../src/lib/abi.ts";

const NETWORKS = {
  testnet: "https://rpc.testnet.chain.robinhood.com",
  mainnet: "https://rpc.mainnet.chain.robinhood.com",
};
const network = process.env.NETWORK || "testnet";
const rpc = process.env.RPC_URL || NETWORKS[network];
if (!rpc) throw new Error(`NETWORK must be one of ${Object.keys(NETWORKS).join(", ")}`);
const site = (process.env.SITE ?? "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(site)) throw new Error("SITE must be the site's URL");
const launcher = getAddress(process.env.LAUNCHER ?? "");
const handles = (process.env.HANDLES || "jack").split(",").map((h) => h.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
// Any address works for a simulation; the attestation is bound to it.
const creator = getAddress("0x000000000000000000000000000000000000dEaD");
const client = createPublicClient({ transport: http(rpc) });
// FeeVault and pons errors bubble up through the launcher, so decode reverts against all three.
const abi = [...launcherAbi, ...feeVaultAbi.filter((x) => x.type === "error"), ...ponsFactoryAbi.filter((x) => x.type === "error")];

const res = await fetch(`${site}/api/attest`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ network, creator, handles }),
});
const att = await res.json().catch(() => ({}));
if (!res.ok) throw new Error(`/api/attest answered ${res.status}: ${att.error ?? "no error message"}`);
console.log(`✔ ${site} attested ${att.handles.map((h, i) => `@${h} → ${att.xIds[i]}`).join(", ")} on ${network}`);

const [version, , , launchFee, economics] = await client.readContract({ address: launcher, abi: launcherAbi, functionName: "launchTerms" });
// Equal shares that add up to 100%.
const bps = handles.map((_, i) => Math.floor(10_000 / handles.length) + (i < 10_000 % handles.length ? 1 : 0));
const split = { xIds: att.xIds.map(BigInt), handles: att.handles, bps, deadline: BigInt(att.deadline), attestation: att.attestation };
const params = {
  name: "Smoke Test",
  symbol: "SMOKE",
  logo: "",
  description: "",
  socials: { twitter: "", telegram: "", discord: "", website: "", farcaster: "" },
  creatorTaxBps: 0,
  salt: toHex(BigInt(Date.now()), { size: 32 }),
  expectedEconomics: economics,
};

async function simulate(label, firstBuy) {
  const value = launchFee + firstBuy;
  const { result } = await client.simulateContract({
    address: launcher,
    abi,
    functionName: "launch",
    args: [params, split, firstBuy, 0n, version],
    value,
    account: creator,
    // Gives the simulated creator enough ETH for the value; nothing is really spent.
    stateOverride: [{ address: creator, balance: value + parseEther("1") }],
  });
  console.log(`✔ launch ${label} would succeed → token ${result[0]}`);
}

await simulate("without a first buy", 0n);
await simulate(`with a ${formatEther(parseEther("0.001"))} ETH first buy`, parseEther("0.001"));
