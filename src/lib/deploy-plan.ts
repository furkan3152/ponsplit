import {
  concat,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  getContractAddress,
  keccak256,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  feeVaultAbi,
  launcherAbi,
  ponsDeployerAbi,
  ponsEscrowAbi,
  ponsExecutorAbi,
  ponsFactoryAbi,
  ponsHookAbi,
  ponsLockerAbi,
  ponsVaultAbi,
} from "./abi";
import { PONS_MAINNET_FACTORY, UNISWAP, type Network } from "./networks";
import copyTerms from "./pons-copy-terms.json";

/**
 * What /setup deploys from the owner's wallet, worked out from the chain on every read so a reload,
 * another device or a wallet app switching tabs mid-way can never deploy anything twice.
 *
 * Every contract goes through the deterministic CREATE2 proxy (present on both Robinhood networks)
 * with a salt derived from the owner's address, so its address is known before it exists and is the
 * same whoever pays the gas. Mirrors contracts/scripts/lib/pons-stack.js, which deploys the same
 * contracts the same way for the Hardhat tests.
 *
 *  - Testnet: PonsEarn's copy of Pons v2 (7 contracts, then 9 wiring calls with Pons's live mainnet
 *    terms) against the Uniswap v4 contracts Robinhood Chain testnet already has, then PonsEarn.
 *  - Mainnet: PonsEarn only (FeeVault, launcher, one wiring call), on the real Pons.
 */
export const CREATE2_PROXY = copyTerms.create2Proxy as Address;

export type PlanStep = {
  key: string;
  /** What the step does, for the owner. */
  label: string;
  group: "pons" | "ponsearn";
  done: boolean;
  /** The transaction that performs it, sent from the owner's wallet. */
  tx: { to: Address; data: Hex };
};

export type PlanAddresses = {
  ponsFactory: Address;
  feeVault: Address;
  launcher: Address;
  /** The rest of PonsEarn's Pons copy (testnet only). */
  pons?: { escrow: Address; hook: Address; buybackVault: Address; locker: Address; executor: Address; deployer: Address };
};

export type Plan = {
  owner: Address;
  signer: Address;
  addresses: PlanAddresses;
  steps: PlanStep[];
  /** A transaction from the owner's wallet is still pending; its outcome isn't in the state read. */
  busy: boolean;
  /** Something on-chain isn't what the plan expects; nothing should be sent until it's resolved. */
  problem?: string;
};

type Bytecodes = typeof import("./bytecode").bytecode;
let loaded: Promise<Bytecodes> | null = null;
/** The contracts' creation code (large), loaded when /setup first needs it. */
export const loadBytecode = () => (loaded ??= import("./bytecode").then((m) => m.bytecode));

/** keccak256(abi.encode("ponsearn:v1", owner, name[, i])): pons-stack.js's `salt`. */
export function saltFor(owner: Address, name: string, extra?: bigint): Hex {
  return keccak256(
    extra === undefined
      ? encodeAbiParameters([{ type: "string" }, { type: "address" }, { type: "string" }], [copyTerms.saltPrefix, owner, name])
      : encodeAbiParameters(
          [{ type: "string" }, { type: "address" }, { type: "string" }, { type: "uint256" }],
          [copyTerms.saltPrefix, owner, name, extra]
        )
  );
}

const create2At = (salt: Hex, initcode: Hex) => getContractAddress({ opcode: "CREATE2", from: CREATE2_PROXY, salt, bytecode: initcode });

const hookSalts = new Map<string, Hex>();
/** The first salt that puts the hook at an address whose low 14 bits are its Uniswap v4 permissions. */
export function mineHookSalt(owner: Address, initcode: Hex): Hex {
  const bytecodeHash = keccak256(initcode);
  const cached = hookSalts.get(`${owner}:${bytecodeHash}`);
  if (cached) return cached;
  const flags = BigInt(copyTerms.hookFlags);
  for (let i = 0n; i < 1_000_000n; i++) {
    const salt = saltFor(owner, "PonsV2MemeHook", i);
    const address = getContractAddress({ opcode: "CREATE2", from: CREATE2_PROXY, salt, bytecodeHash });
    if ((BigInt(address) & 0x3fffn) === flags) {
      hookSalts.set(`${owner}:${bytecodeHash}`, salt);
      return salt;
    }
  }
  throw new Error("No hook address found.");
}

type Deploy = { key: string; label: string; group: PlanStep["group"]; address: Address; salt: Hex; initcode: Hex };

const deployTx = (d: Deploy) => ({ to: CREATE2_PROXY, data: concat([d.salt, d.initcode]) });
const callTx = (to: Address, abi: Abi, functionName: string, args: readonly unknown[]) => ({
  to,
  data: encodeFunctionData({ abi, functionName, args } as Parameters<typeof encodeFunctionData>[0]),
});

/** Every address the plan deploys to, for this owner and signing key (nothing is read from the chain). */
export async function planDeploys(n: Network, owner: Address, signer: Address): Promise<{ deploys: Deploy[]; addresses: PlanAddresses }> {
  const code = await loadBytecode();
  const deploys: Deploy[] = [];
  const add = (key: string, label: string, group: Deploy["group"], salt: Hex, initcode: Hex) => {
    const d = { key, label, group, salt, initcode, address: create2At(salt, initcode) };
    deploys.push(d);
    return d.address;
  };
  let ponsFactory: Address = PONS_MAINNET_FACTORY;
  let pons: PlanAddresses["pons"];
  if (n.ponsIsCopy) {
    const { poolManager, positionManager, permit2 } = UNISWAP;
    const escrow = add("pons:escrow", "Pons fee escrow", "pons", saltFor(owner, "PonsV2FeeEscrow"), encodeDeployData({ abi: ponsEscrowAbi, bytecode: code.ponsFeeEscrow }));
    const hookCode = encodeDeployData({ abi: ponsHookAbi, bytecode: code.ponsMemeHook, args: [poolManager, escrow, owner, owner] });
    const hook = add("pons:hook", "Pons Uniswap v4 hook", "pons", mineHookSalt(owner, hookCode), hookCode);
    const buybackVault = add(
      "pons:vault",
      "Pons buyback vault",
      "pons",
      saltFor(owner, "PonsV2BuybackVault"),
      encodeDeployData({ abi: ponsVaultAbi, bytecode: code.ponsBuybackVault, args: [owner, hook, escrow] })
    );
    const locker = add(
      "pons:locker",
      "Pons liquidity locker",
      "pons",
      saltFor(owner, "PonsV2LaunchLocker"),
      encodeDeployData({ abi: ponsLockerAbi, bytecode: code.ponsLaunchLocker, args: [owner, positionManager] })
    );
    ponsFactory = add(
      "pons:factory",
      "Pons launch factory",
      "pons",
      saltFor(owner, "PonsV2LaunchFactory"),
      encodeDeployData({
        abi: ponsFactoryAbi,
        bytecode: code.ponsLaunchFactory,
        args: [owner, poolManager, positionManager, permit2, locker, hook, escrow, buybackVault, BigInt(copyTerms.launchFeeWei)],
      })
    );
    const executor = add(
      "pons:executor",
      "Pons graduation executor",
      "pons",
      saltFor(owner, "PonsV2GraduationExecutor"),
      encodeDeployData({ abi: ponsExecutorAbi, bytecode: code.ponsGraduationExecutor, args: [positionManager, permit2, locker, ponsFactory] })
    );
    const deployer = add(
      "pons:deployer",
      "Pons launch deployer",
      "pons",
      saltFor(owner, "PonsV2LaunchDeployer"),
      encodeDeployData({ abi: ponsDeployerAbi, bytecode: code.ponsLaunchDeployer, args: [ponsFactory] })
    );
    pons = { escrow, hook, buybackVault, locker, executor, deployer };
  }
  const feeVault = add("earn:vault", "PonsEarn FeeVault", "ponsearn", saltFor(owner, "FeeVault"), encodeDeployData({ abi: feeVaultAbi, bytecode: code.feeVault, args: [owner, signer] }));
  const launcher = add(
    "earn:launcher",
    "PonsEarn launcher",
    "ponsearn",
    saltFor(owner, "PonsEarnLauncher"),
    encodeDeployData({ abi: launcherAbi, bytecode: code.launcher, args: [owner, feeVault, ponsFactory] })
  );
  return { deploys, addresses: { ponsFactory, feeVault, launcher, pons } };
}

const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const hasCode = (code: Hex | undefined) => Boolean(code && code !== "0x");

/** Where the deployment stands on-chain, and the transactions still to send, in order. */
export async function readPlan(client: PublicClient, n: Network, owner: Address, signer: Address): Promise<Plan> {
  const { deploys, addresses } = await planDeploys(n, owner, signer);
  const [latest, pending, ...codes] = await Promise.all([
    client.getTransactionCount({ address: owner }),
    client.getTransactionCount({ address: owner, blockTag: "pending" }),
    ...deploys.map((d) => client.getCode({ address: d.address })),
  ]);
  const deployed = new Map(deploys.map((d, i) => [d.key, hasCode(codes[i])]));
  const steps: PlanStep[] = [];
  const problems: string[] = [];
  const pushDeploy = (key: string) => {
    const d = deploys.find((x) => x.key === key)!;
    steps.push({ key, label: `Deploy the ${d.label}`, group: d.group, done: deployed.get(key)!, tx: deployTx(d) });
  };
  /** A wiring call: done when `current` already reads `want` (or anything non-empty, for set-once links). */
  const wire = async (key: string, label: string, group: PlanStep["group"], ready: boolean, read: () => Promise<unknown>, isDone: (v: unknown) => boolean, tx: PlanStep["tx"], expect?: Address) => {
    let done = false;
    if (ready) {
      const v = await read();
      done = isDone(v);
      if (expect && typeof v === "string" && v !== zeroAddress && !same(v, expect)) problems.push(`${label}: it points at ${v}, not ${expect}.`);
    }
    steps.push({ key, label, group, done, tx });
  };
  const set = (v: unknown) => typeof v === "string" && v !== zeroAddress;

  if (n.ponsIsCopy && addresses.pons) {
    const p = addresses.pons;
    const f = addresses.ponsFactory;
    for (const key of ["pons:escrow", "pons:hook", "pons:vault", "pons:locker", "pons:factory", "pons:executor", "pons:deployer"]) pushDeploy(key);
    const factoryUp = deployed.get("pons:factory")!;
    const read = (address: Address, abi: Abi, functionName: string) => () => client.readContract({ address, abi, functionName } as Parameters<typeof client.readContract>[0]);
    await wire("pons:locker-factory", "Connect the locker to the factory", "pons", deployed.get("pons:locker")! && factoryUp, read(p.locker, ponsLockerAbi, "factory"), set, callTx(p.locker, ponsLockerAbi, "setFactory", [f]), f);
    await wire("pons:vault-factory", "Connect the buyback vault to the factory", "pons", deployed.get("pons:vault")! && factoryUp, read(p.buybackVault, ponsVaultAbi, "factory"), set, callTx(p.buybackVault, ponsVaultAbi, "setFactory", [f]), f);
    await wire("pons:hook-factory", "Connect the hook to the factory", "pons", deployed.get("pons:hook")! && factoryUp, read(p.hook, ponsHookAbi, "factory"), set, callTx(p.hook, ponsHookAbi, "setFactory", [f]), f);
    await wire("pons:hook-vault", "Connect the hook to the buyback vault", "pons", deployed.get("pons:hook")! && deployed.get("pons:vault")!, read(p.hook, ponsHookAbi, "buybackVault"), set, callTx(p.hook, ponsHookAbi, "setBuybackVault", [p.buybackVault]), p.buybackVault);
    await wire("pons:executor-link", "Give the factory its graduation executor", "pons", factoryUp && deployed.get("pons:executor")!, read(f, ponsFactoryAbi, "graduationExecutor"), set, callTx(f, ponsFactoryAbi, "setGraduationExecutor", [p.executor]), p.executor);
    await wire("pons:deployer-link", "Give the factory its launch deployer", "pons", factoryUp && deployed.get("pons:deployer")!, read(f, ponsFactoryAbi, "launchDeployer"), set, callTx(f, ponsFactoryAbi, "setLaunchDeployer", [p.deployer]), p.deployer);
    const c = copyTerms.launchConfig;
    const config = {
      supply: BigInt(c.supply),
      curveFeeBps: BigInt(c.curveFeeBps),
      phantomQuote: BigInt(c.phantomQuote),
      graduationThreshold: BigInt(c.graduationThreshold),
      poolFee: c.poolFee,
      tickSpacing: c.tickSpacing,
      enabled: c.enabled,
    };
    await wire("pons:config", "Add Pons's launch terms (1% fee, graduation at 4.2 ETH)", "pons", factoryUp, read(f, ponsFactoryAbi, "launchConfigCount"), (v) => typeof v === "bigint" && v > 0n, callTx(f, ponsFactoryAbi, "addLaunchConfig", [config]));
    await wire(
      "pons:snipe",
      `Set the opening snipe tax to ${copyTerms.snipeTaxSeconds} seconds, as on Pons`,
      "pons",
      factoryUp,
      read(f, ponsFactoryAbi, "snipeTaxSeconds"),
      (v) => v === BigInt(copyTerms.snipeTaxSeconds),
      callTx(f, ponsFactoryAbi, "setSnipeTaxSeconds", [BigInt(copyTerms.snipeTaxSeconds)])
    );
    await wire("pons:open", "Open launches", "pons", factoryUp, read(f, ponsFactoryAbi, "launchEnabled"), (v) => v === true, callTx(f, ponsFactoryAbi, "setLaunchEnabled", [true]));
  }

  pushDeploy("earn:vault");
  pushDeploy("earn:launcher");
  const bothUp = deployed.get("earn:vault")! && deployed.get("earn:launcher")!;
  await wire(
    "earn:link",
    "Let the launcher register fee splits in the FeeVault",
    "ponsearn",
    bothUp,
    () => client.readContract({ address: addresses.feeVault, abi: feeVaultAbi, functionName: "isLauncher", args: [addresses.launcher] }),
    (v) => v === true,
    callTx(addresses.feeVault, feeVaultAbi as Abi, "setLauncher", [addresses.launcher, true])
  );
  // A factory that doesn't exist yet can't have a launcher on it; one deployed on mainnet must be Pons's.
  if (!n.ponsIsCopy) {
    const factoryCode = await client.getCode({ address: addresses.ponsFactory });
    if (!hasCode(factoryCode)) problems.push(`Pons's factory ${addresses.ponsFactory} isn't on ${n.label}.`);
  }
  // /setup tracks confirmed steps by key: two steps sharing one would stall it.
  if (new Set(steps.map((s) => s.key)).size !== steps.length) throw new Error("Duplicate deployment step keys.");
  return { owner, signer, addresses, steps, busy: pending > latest, problem: problems[0] };
}

/**
 * Whether the owner's wallet accepts a plain ETH transfer. On testnet it is the pons copy's
 * protocol fee recipient, and pons sends it every launch fee: a wallet with delegated code that
 * refuses ETH would make every launch revert. Simulated as a transfer from the wallet to itself, so
 * its own balance pays; only a revert counts as a refusal (anything else can't be judged).
 */
export async function acceptsEth(client: PublicClient, wallet: Address, value: bigint): Promise<boolean> {
  try {
    await client.call({ account: wallet, to: wallet, value });
    return true;
  } catch (e) {
    return !/revert/i.test(String((e as Error)?.message ?? e));
  }
}
