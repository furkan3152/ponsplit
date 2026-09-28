// Deploys the real contracts PonsEarn runs on, for Hardhat tests and local chains:
//   - Uniswap v4 (PoolManager, PositionManager) and Permit2, on a bare local chain only (Robinhood
//     Chain testnet and mainnet have them already, at the addresses in src/lib/pons-copy-terms.json);
//   - a copy of Pons v2 built from its Blockscout-verified mainnet sources (vendor/), with the
//     terms Pons runs on mainnet;
//   - PonsEarn (FeeVault + PonsEarnLauncher).
// Pons and PonsEarn are deployed through the deterministic CREATE2 proxy with salts derived from the
// owner, like /setup does from the owner's wallet (src/lib/deploy-plan.ts), so a rerun finds what
// is already there instead of deploying twice.
const { ethers, network } = require("hardhat");
const terms = require("../../../src/lib/pons-copy-terms.json");

const PROXY = terms.create2Proxy;
// Arachnid's deterministic deployment proxy (the same 69 bytes on every chain that has it).
const PROXY_CODE =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";
const coder = ethers.AbiCoder.defaultAbiCoder();

const vendor = (name) => require(`../../vendor/out/${name}.json`);

function factoryFor(name, signer) {
  const a = vendor(name);
  return new ethers.ContractFactory(a.abi, a.bytecode, signer);
}

async function ensureCreate2Proxy() {
  if ((await ethers.provider.getCode(PROXY)) === "0x") {
    await network.provider.send("hardhat_setCode", [PROXY, PROXY_CODE]);
  }
}

function salt(owner, name, extra) {
  const types = ["string", "address", "string"];
  const values = [terms.saltPrefix, owner, name];
  if (extra !== undefined) {
    types.push("uint256");
    values.push(extra);
  }
  return ethers.keccak256(coder.encode(types, values));
}

async function initcode(factory, args) {
  return (await factory.getDeployTransaction(...args)).data;
}

/** Deploys `initcode` at its CREATE2 address unless something is already there; returns the address. */
async function create2(signer, s, code) {
  const address = ethers.getCreate2Address(PROXY, s, ethers.keccak256(code));
  if ((await ethers.provider.getCode(address)) === "0x") {
    await (await signer.sendTransaction({ to: PROXY, data: ethers.concat([s, code]) })).wait();
    if ((await ethers.provider.getCode(address)) === "0x") throw new Error(`CREATE2 deployment to ${address} failed`);
  }
  return address;
}

/** The first salt that puts the hook at an address whose low bits are its Uniswap v4 permissions. */
function mineHookSalt(owner, code) {
  const hash = ethers.keccak256(code);
  for (let i = 0; i < 1_000_000; i++) {
    const s = salt(owner, "PonsV2MemeHook", i);
    const address = ethers.getCreate2Address(PROXY, s, hash);
    if ((BigInt(address) & 0x3fffn) === BigInt(terms.hookFlags)) return s;
  }
  throw new Error("no hook salt found");
}

/** Uniswap v4 + Permit2 on a bare chain (never on Robinhood Chain, which has the real ones). */
async function deployUniswapLocal(signer) {
  const permit2 = await (await factoryFor("Permit2", signer).deploy()).waitForDeployment();
  const poolManager = await (await factoryFor("PoolManager", signer).deploy(signer.address)).waitForDeployment();
  const positionManager = await (
    await factoryFor("PositionManager", signer).deploy(await poolManager.getAddress(), await permit2.getAddress(), 300_000, ethers.ZeroAddress, ethers.ZeroAddress)
  ).waitForDeployment();
  return {
    permit2: await permit2.getAddress(),
    poolManager: await poolManager.getAddress(),
    positionManager: await positionManager.getAddress(),
  };
}

/** A copy of Pons v2 owned by `owner`, wired and open for launches like Pons mainnet. */
async function deployPonsCopy(owner, uni = terms.uniswap) {
  await ensureCreate2Proxy();
  const o = owner.address;
  const escrow = await create2(owner, salt(o, "PonsV2FeeEscrow"), await initcode(factoryFor("PonsV2FeeEscrow"), []));
  const hookCode = await initcode(factoryFor("PonsV2MemeHook"), [uni.poolManager, escrow, o, o]);
  const hook = await create2(owner, mineHookSalt(o, hookCode), hookCode);
  const vault = await create2(owner, salt(o, "PonsV2BuybackVault"), await initcode(factoryFor("PonsV2BuybackVault"), [o, hook, escrow]));
  const locker = await create2(owner, salt(o, "PonsV2LaunchLocker"), await initcode(factoryFor("PonsV2LaunchLocker"), [o, uni.positionManager]));
  const factoryAddress = await create2(
    owner,
    salt(o, "PonsV2LaunchFactory"),
    await initcode(factoryFor("PonsV2LaunchFactory"), [o, uni.poolManager, uni.positionManager, uni.permit2, locker, hook, escrow, vault, terms.launchFeeWei])
  );
  const executor = await create2(
    owner,
    salt(o, "PonsV2GraduationExecutor"),
    await initcode(factoryFor("PonsV2GraduationExecutor"), [uni.positionManager, uni.permit2, locker, factoryAddress])
  );
  const deployer = await create2(owner, salt(o, "PonsV2LaunchDeployer"), await initcode(factoryFor("PonsV2LaunchDeployer"), [factoryAddress]));

  const at = (name, address) => new ethers.Contract(address, vendor(name).abi, owner);
  const factory = at("PonsV2LaunchFactory", factoryAddress);
  const wire = async (done, send) => {
    if (!(await done())) await (await send()).wait();
  };
  const unset = async (read) => (await read()) === ethers.ZeroAddress;
  await wire(async () => !(await unset(() => at("PonsV2LaunchLocker", locker).factory())), () => at("PonsV2LaunchLocker", locker).setFactory(factoryAddress));
  await wire(async () => !(await unset(() => at("PonsV2BuybackVault", vault).factory())), () => at("PonsV2BuybackVault", vault).setFactory(factoryAddress));
  await wire(async () => !(await unset(() => at("PonsV2MemeHook", hook).factory())), () => at("PonsV2MemeHook", hook).setFactory(factoryAddress));
  await wire(async () => !(await unset(() => at("PonsV2MemeHook", hook).buybackVault())), () => at("PonsV2MemeHook", hook).setBuybackVault(vault));
  await wire(async () => !(await unset(() => factory.graduationExecutor())), () => factory.setGraduationExecutor(executor));
  await wire(async () => !(await unset(() => factory.launchDeployer())), () => factory.setLaunchDeployer(deployer));
  await wire(async () => (await factory.launchConfigCount()) > 0n, () => factory.addLaunchConfig(terms.launchConfig));
  await wire(async () => (await factory.snipeTaxSeconds()) === BigInt(terms.snipeTaxSeconds), () => factory.setSnipeTaxSeconds(terms.snipeTaxSeconds));
  await wire(() => factory.launchEnabled(), () => factory.setLaunchEnabled(true));
  return { factory: factoryAddress, hook, escrow, vault, locker, executor, deployer, ...uni };
}

/** PonsEarn's FeeVault and launcher on top of a Pons factory, owned by `owner`. */
async function deployPonsEarn(owner, { signer, ponsFactory }) {
  await ensureCreate2Proxy();
  const o = owner.address;
  const vaultF = await ethers.getContractFactory("FeeVault");
  const launcherF = await ethers.getContractFactory("PonsEarnLauncher");
  const feeVault = await create2(owner, salt(o, "FeeVault"), await initcode(vaultF, [o, signer]));
  const launcher = await create2(owner, salt(o, "PonsEarnLauncher"), await initcode(launcherF, [o, feeVault, ponsFactory]));
  const vault = await ethers.getContractAt("FeeVault", feeVault, owner);
  if (!(await vault.isLauncher(launcher))) await (await vault.setLauncher(launcher, true)).wait();
  return { feeVault, launcher };
}

module.exports = { deployUniswapLocal, deployPonsCopy, deployPonsEarn, ensureCreate2Proxy, vendor, terms, PROXY };
