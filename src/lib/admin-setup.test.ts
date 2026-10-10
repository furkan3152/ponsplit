import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { ADMIN_WALLET, MAINNET_GENESIS_HASH } from "./admin-config";
import { applyVercelConfiguration, configuredProgramStatus, serverEscrowArtifact, VERCEL_PROJECT_ID } from "./admin-setup";
import { PROGRAM_DATA_HEADER_SIZE, UPGRADEABLE_LOADER, programDataAddress } from "./solana/program-deploy";
import { serverConnection } from "./solana/server";

const program = new PublicKey("6vstPGrbwDSPQtCsketQSmajDiuaDfFyJ24DVzywMH8P");
const verifier = new PublicKey("F2gqCRwjdLYMRUFjpEd9MATNXmaeSKRs3mWbf5UE4SaA");
const values = { NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID: program.toBase58(), NEXT_PUBLIC_TIKSPLIT_VERIFIER: verifier.toBase58() };
const project = { id: VERCEL_PROJECT_ID, name: "test-project", link: { type: "github", repoId: 123, repo: "ponsplit", org: "furkan3152" } };

test("server artifact validation and program status require exact ELF, zero padding, loader PDA, and admin authority", async (t) => {
  const artifact = await serverEscrowArtifact();
  const connection = serverConnection();
  const previousGenesis = connection.getGenesisHash;
  const previousMultiple = connection.getMultipleAccountsInfo;
  const previousSingle = connection.getAccountInfo;
  t.after(() => { connection.getGenesisHash = previousGenesis; connection.getMultipleAccountsInfo = previousMultiple; connection.getAccountInfo = previousSingle; });
  connection.getGenesisHash = async () => MAINNET_GENESIS_HASH;
  connection.getAccountInfo = async () => { assert.fail("program checks must read Program and ProgramData in one batch"); };
  const accountData = Buffer.alloc(36);
  accountData.writeUInt32LE(2);
  programDataAddress(program).toBuffer().copy(accountData, 4);
  const code = Buffer.alloc(PROGRAM_DATA_HEADER_SIZE + artifact.bytes.length + 16);
  code.writeUInt32LE(3);
  code[12] = 1;
  ADMIN_WALLET.toBuffer().copy(code, 13);
  Buffer.from(artifact.bytes).copy(code, PROGRAM_DATA_HEADER_SIZE);
  const account: AccountInfo<Buffer> = { data: accountData, executable: true, owner: UPGRADEABLE_LOADER, lamports: 1, rentEpoch: 0 };
  const data: AccountInfo<Buffer> = { data: code, executable: false, owner: UPGRADEABLE_LOADER, lamports: 1, rentEpoch: 0 };
  connection.getMultipleAccountsInfo = async (keys) => {
    assert.deepEqual(keys.map((key) => key.toBase58()), [program.toBase58(), programDataAddress(program).toBase58()]);
    return [account, data];
  };
  assert.deepEqual(await configuredProgramStatus(program), { deployed: true, upgradeAuthority: ADMIN_WALLET.toBase58(), artifactMatches: true });
  code[code.length - 1] = 1;
  assert.equal((await configuredProgramStatus(program)).artifactMatches, false);
  code[code.length - 1] = 0;
  code[PROGRAM_DATA_HEADER_SIZE + artifact.bytes.length - 1] ^= 1;
  assert.equal((await configuredProgramStatus(program)).artifactMatches, false);
  code[PROGRAM_DATA_HEADER_SIZE + artifact.bytes.length - 1] ^= 1;
  verifier.toBuffer().copy(code, 13);
  assert.equal((await configuredProgramStatus(program)).artifactMatches, false);
  ADMIN_WALLET.toBuffer().copy(code, 13);
  verifier.toBuffer().copy(accountData, 4);
  assert.equal((await configuredProgramStatus(program)).deployed, false);
  connection.getGenesisHash = async () => "testnet";
  await assert.rejects(() => configuredProgramStatus(program), /mainnet/);
});

test("hosting mutations are allowlisted, linked to the exact repo, and report partial or uncertain results safely", async (t) => {
  const oldFetch = globalThis.fetch;
  const oldToken = process.env.VERCEL_DEPLOY_TOKEN;
  const oldCommit = process.env.VERCEL_GIT_COMMIT_SHA;
  const oldTeam = process.env.VERCEL_TEAM_ID;
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.VERCEL_DEPLOY_TOKEN; else process.env.VERCEL_DEPLOY_TOKEN = oldToken;
    if (oldCommit === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA; else process.env.VERCEL_GIT_COMMIT_SHA = oldCommit;
    if (oldTeam === undefined) delete process.env.VERCEL_TEAM_ID; else process.env.VERCEL_TEAM_ID = oldTeam;
  });
  delete process.env.VERCEL_DEPLOY_TOKEN;
  delete process.env.VERCEL_TEAM_ID;
  globalThis.fetch = async () => { assert.fail("manual configuration must not access hosting"); };
  assert.equal((await applyVercelConfiguration(values)).applied, false);
  process.env.VERCEL_DEPLOY_TOKEN = "test-only-vercel-token-do-not-disclose";
  process.env.VERCEL_GIT_COMMIT_SHA = "ab".repeat(20);
  await assert.rejects(() => applyVercelConfiguration({ ...values, VERCEL_DEPLOY_TOKEN: "not-allowed" } as typeof values), /Only escrow/);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ ...project, link: { ...project.link, repo: "another-repo" } }); };
  await assert.rejects(() => applyVercelConfiguration(values), /furkan3152\/ponsplit/);
  assert.equal(calls, 1);

  let environmentResult: unknown = { created: [{ key: Object.keys(values)[0] }], failed: [{ key: Object.keys(values)[1], error: "internal-secret-detail" }] };
  let failEnvironment = false;
  let failDeployment = false;
  let deployments = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer test-only-vercel-token-do-not-disclose");
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.vercel.com");
    if (url.pathname.endsWith("/env")) {
      const sent = JSON.parse(String(init?.body)) as { key: string; value: string; target: string[]; type: string }[];
      assert.deepEqual(sent.map((entry) => entry.key).sort(), Object.keys(values).sort());
      assert.ok(sent.every((entry) => entry.type === "plain" && entry.target.length === 1 && entry.target[0] === "production"));
      if (failEnvironment) return new Response("internal-secret-detail", { status: 503 });
      return Response.json(environmentResult);
    }
    if (url.pathname === "/v13/deployments") {
      deployments++;
      const sent = JSON.parse(String(init?.body));
      assert.equal(sent.gitSource.ref, "ab".repeat(20));
      if (failDeployment) return new Response("internal-secret-detail", { status: 503 });
      return Response.json({ id: "dpl_test", url: "test-project.vercel.app" });
    }
    return Response.json(project);
  };
  const partial = await applyVercelConfiguration(values);
  assert.equal(partial.applied, false);
  assert.equal(partial.environmentUpdated, false);
  assert.equal(deployments, 0);
  assert.ok(!JSON.stringify(partial).includes("internal-secret-detail"));
  assert.ok(!JSON.stringify(partial).includes(process.env.VERCEL_DEPLOY_TOKEN));
  failEnvironment = true;
  const uncertain = await applyVercelConfiguration(values);
  assert.equal(uncertain.applied, false);
  assert.equal(uncertain.environmentUpdated, null);
  assert.equal(deployments, 0);
  failEnvironment = false;
  environmentResult = { created: Object.keys(values).map((key) => ({ key })), failed: [] };
  failDeployment = true;
  const deploymentFailure = await applyVercelConfiguration(values);
  assert.equal(deploymentFailure.applied, false);
  assert.equal(deploymentFailure.environmentUpdated, true);
  failDeployment = false;
  const success = await applyVercelConfiguration(values);
  assert.equal(success.applied, true);
  assert.equal(success.environmentUpdated, true);
  assert.deepEqual(success.deployment, { id: "dpl_test", url: "https://test-project.vercel.app" });
});
