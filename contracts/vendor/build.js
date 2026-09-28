// Compiles the vendored Pons v2 and Uniswap v4 sources with the exact compiler and settings each
// was verified with on Robinhood Chain (vendor/verified.json), into vendor/out/<Contract>.json.
//   node vendor/build.js            compile everything
//   node vendor/build.js pons       one group only
// Pons is deployed from these artifacts on testnet (PonsEarn's own copy) and on local test chains;
// Uniswap v4 and Permit2 only on local test chains (both networks already have the real ones).
const fs = require("fs");
const path = require("path");

const root = __dirname;
const verified = require("./verified.json");

const PONS = [
  "PonsV2LaunchFactory",
  "PonsV2MemeHook",
  "PonsV2FeeEscrow",
  "PonsV2BuybackVault",
  "PonsV2LaunchLocker",
  "PonsV2LaunchDeployer",
  "PonsV2GraduationExecutor",
  "PonsV2GraduationGuard",
  "PonsV2LaunchAndBuy",
];

const GROUPS = {
  pons: { solc: "solc-0.8.35", dir: "pons", contracts: PONS, extra: ["PonsV2BondingCurve", "PonsV2LauncherToken"] },
  v4core: { solc: "solc-0.8.26", dir: "uniswap", contracts: ["PoolManager"] },
  v4periphery: { solc: "solc-0.8.26", dir: "uniswap", contracts: ["PositionManager"] },
  permit2: { solc: "solc-0.8.17", dir: "uniswap", contracts: ["Permit2"] },
};

function compile(name, group) {
  const solc = require(group.solc);
  const first = verified[group.contracts[0]];
  const files = new Set();
  for (const c of group.contracts) {
    // Every contract in a group was verified with the same settings; make sure of it.
    if (JSON.stringify(verified[c].settings) !== JSON.stringify(first.settings)) throw new Error(`${c}: settings differ from ${group.contracts[0]}`);
    verified[c].files.forEach((f) => files.add(f));
  }
  const sources = {};
  for (const f of files) sources[f] = { content: fs.readFileSync(path.join(root, group.dir, f), "utf8") };
  const input = {
    language: "Solidity",
    sources,
    settings: {
      ...first.settings,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } },
    },
  };
  const t0 = Date.now();
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const wanted = new Set([...group.contracts, ...(group.extra || [])]);
  fs.mkdirSync(path.join(root, "out"), { recursive: true });
  for (const [file, contracts] of Object.entries(output.contracts)) {
    for (const [contract, out] of Object.entries(contracts)) {
      if (!wanted.has(contract)) continue;
      const artifact = {
        contractName: contract,
        sourceName: file,
        compiler: solc.version(),
        abi: out.abi,
        bytecode: "0x" + out.evm.bytecode.object,
        deployedBytecode: "0x" + out.evm.deployedBytecode.object,
        immutableReferences: out.evm.deployedBytecode.immutableReferences,
      };
      fs.writeFileSync(path.join(root, "out", `${contract}.json`), JSON.stringify(artifact, null, 1) + "\n");
      wanted.delete(contract);
    }
  }
  if (wanted.size) throw new Error(`${name}: missing ${[...wanted].join(", ")}`);
  console.log(`${name}: ${solc.version()} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const only = process.argv[2];
for (const [name, group] of Object.entries(GROUPS)) {
  if (!only || only === name) compile(name, group);
}
