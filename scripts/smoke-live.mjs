// Read-only launch check against a live site. The site's /api/attest resolves real X accounts and
// signs an attestation with the server key, exactly as for a real launch; the attestation is then
// used to simulate createToken on the live contracts with eth_call (with and without a first buy).
// Nothing is sent and no key is needed.
//
//   SITE=https://ponsplit-testnet.onrender.com NETWORK=testnet LAUNCHPAD=0x... [HANDLES=jack,x] \
//     node --experimental-strip-types scripts/smoke-live.mjs
import { BaseError, ContractFunctionRevertedError, createPublicClient, formatEther, getAddress, http, parseEther } from "viem";
import { feeVaultAbi, launchpadAbi } from "../src/lib/abi.ts";

const NETWORKS = {
  testnet: "https://rpc.testnet.chain.robinhood.com",
  mainnet: "https://rpc.mainnet.chain.robinhood.com",
};
const rpc = process.env.RPC_URL || NETWORKS[process.env.NETWORK || "testnet"];
if (!rpc) throw new Error(`NETWORK must be one of ${Object.keys(NETWORKS).join(", ")}`);
const site = (process.env.SITE ?? "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(site)) throw new Error("SITE must be the site's URL");
const launchpad = getAddress(process.env.LAUNCHPAD ?? "");
const handles = (process.env.HANDLES || "jack").split(",").map((h) => h.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
// Any address works for a simulation; the attestation is bound to it.
const creator = getAddress("0x000000000000000000000000000000000000dEaD");
const client = createPublicClient({ transport: http(rpc) });
// FeeVault errors bubble up through the launchpad, so decode reverts against both.
const abi = [...launchpadAbi, ...feeVaultAbi.filter((x) => x.type === "error")];

const res = await fetch(`${site}/api/attest`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ creator, handles }),
});
const att = await res.json().catch(() => ({}));
if (!res.ok) throw new Error(`/api/attest answered ${res.status}: ${att.error ?? "no error message"}`);
console.log(`✔ ${site} attested ${att.handles.map((h, i) => `@${h} → ${att.xIds[i]}`).join(", ")}`);

const [termsVersion, creationFee] = await Promise.all([
  client.readContract({ address: launchpad, abi: launchpadAbi, functionName: "termsVersion" }),
  client.readContract({ address: launchpad, abi: launchpadAbi, functionName: "creationFee" }),
]);
// Equal shares that add up to 100%.
const bps = handles.map((_, i) => Math.floor(10_000 / handles.length) + (i < 10_000 % handles.length ? 1 : 0));
const split = { xIds: att.xIds.map(BigInt), handles: att.handles, bps, deadline: BigInt(att.deadline), attestation: att.attestation };
const args = ["Smoke Test", "SMOKE", "", split, 0n, termsVersion];

async function simulate(label, value) {
  const { result } = await client.simulateContract({
    address: launchpad,
    abi,
    functionName: "createToken",
    args,
    value,
    account: creator,
    // Gives the simulated creator enough ETH for the value; nothing is really spent.
    stateOverride: value > 0n ? [{ address: creator, balance: value + parseEther("1") }] : undefined,
  });
  console.log(`✔ createToken ${label} would succeed → token ${result}`);
}

await simulate("without a first buy", creationFee);
await simulate(`with a ${formatEther(parseEther("0.001"))} ETH first buy`, creationFee + parseEther("0.001"));

// The same attestation must not work for someone else.
const reverted = await client
  .simulateContract({ address: launchpad, abi, functionName: "createToken", args, value: creationFee, account: getAddress("0x000000000000000000000000000000000000bEEF") })
  .then(() => undefined)
  .catch((e) => (e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : undefined));
if (reverted?.data?.errorName !== "BadSignature") throw new Error(`another creator's launch wasn't refused with BadSignature (${reverted?.shortMessage ?? "it went through"})`);
console.log("✔ the attestation is refused (BadSignature) for a different creator");
console.log("\nLive launch path works.");
