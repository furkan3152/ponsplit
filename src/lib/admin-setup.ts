import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { ADMIN_WALLET, MAINNET_GENESIS_HASH } from "./admin-config";
import { ESCROW_ARTIFACT_MANIFEST, PROGRAM_ACCOUNT_SIZE, PROGRAM_DATA_HEADER_SIZE, programDataAddress, UPGRADEABLE_LOADER, validateEscrowArtifact, type ProgramArtifact } from "./solana/program-deploy";
import { serverPublicConnection } from "./solana/server";

export const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || "prj_K4lYPXiOoIIqWqjNvaJxqqiuBeJI";
export const automaticConfigurationReady = () => Boolean(process.env.VERCEL_DEPLOY_TOKEN?.trim());

export async function serverEscrowArtifact(): Promise<ProgramArtifact> {
  const bytes = new Uint8Array(await readFile(path.join(process.cwd(), "public/programs/tiktok-escrow.so")));
  const artifact = { bytes, manifest: ESCROW_ARTIFACT_MANIFEST };
  await validateEscrowArtifact(artifact);
  return artifact;
}

// Share overlapping readiness/scan checks only. Completed results are never
// cached: the next shutdown check must observe upgrades, authority changes or closure.
const programStatusInflight = new Map<string, Promise<Awaited<ReturnType<typeof readConfiguredProgramStatus>>>>();
export function configuredProgramStatus(program: PublicKey) {
  const address = program.toBase58();
  const current = programStatusInflight.get(address);
  if (current) return current;
  const pending = readConfiguredProgramStatus(program).finally(() => { programStatusInflight.delete(address); });
  programStatusInflight.set(address, pending);
  return pending;
}

async function readConfiguredProgramStatus(program: PublicKey) {
  const connection = serverPublicConnection();
  if (await connection.getGenesisHash() !== MAINNET_GENESIS_HASH) throw new Error("Solana mainnet is required.");
  const address = programDataAddress(program);
  const [accounts, artifact] = await Promise.all([
    connection.getMultipleAccountsInfo([program, address], "confirmed"), serverEscrowArtifact(),
  ]);
  const [account, data] = accounts;
  const validProgram = Boolean(account?.executable && account.owner.equals(UPGRADEABLE_LOADER)
    && account.data.length === PROGRAM_ACCOUNT_SIZE && account.data.readUInt32LE(0) === 2
    && new PublicKey(account.data.subarray(4, 36)).equals(address));
  const validData = Boolean(data && !data.executable && data.owner.equals(UPGRADEABLE_LOADER)
    && data.data.length >= PROGRAM_DATA_HEADER_SIZE + artifact.bytes.length
    && data.data.readUInt32LE(0) === 3 && data.data[12] === 1);
  const authority = validData && data ? new PublicKey(data.data.subarray(13, 45)).toBase58() : null;
  // Check Program and ProgramData from one RPC batch. Only zero capacity padding may follow ELF.
  const matches = Boolean(validProgram && validData && data && authority === ADMIN_WALLET.toBase58()
    && data.data.subarray(PROGRAM_DATA_HEADER_SIZE, PROGRAM_DATA_HEADER_SIZE + artifact.bytes.length).equals(Buffer.from(artifact.bytes))
    && data.data.subarray(PROGRAM_DATA_HEADER_SIZE + artifact.bytes.length).every((byte) => byte === 0));
  return { deployed: validProgram, upgradeAuthority: authority, artifactMatches: matches };
}

/** Only verified public configuration goes to Vercel. Tokens never enter API responses. */
export async function applyVercelConfiguration(values: { NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID: string; NEXT_PUBLIC_TIKSPLIT_VERIFIER: string }) {
  const publicKeys = ["NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID", "NEXT_PUBLIC_TIKSPLIT_VERIFIER"];
  if (Object.keys(values).length !== publicKeys.length || Object.keys(values).some((key) => !publicKeys.includes(key))) throw new Error("Only escrow and verifier public addresses may be configured.");
  const program = new PublicKey(values.NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID);
  const verifier = validVerifier(values.NEXT_PUBLIC_TIKSPLIT_VERIFIER);
  if (program.equals(PublicKey.default) || program.equals(verifier)) throw new Error("The escrow program and managed verifier must be distinct valid public addresses.");
  const token = process.env.VERCEL_DEPLOY_TOKEN?.trim();
  if (!token) return { applied: false as const, environmentUpdated: false, message: "Public addresses verified. Add these values to Vercel and rebuild to activate the integration." };
  const team = process.env.VERCEL_TEAM_ID;
  const suffix = team ? `?teamId=${encodeURIComponent(team)}` : "";
  async function vercel(endpoint: string, init?: RequestInit) {
    const response = await fetch(`https://api.vercel.com${endpoint}`, {
      ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error("Hosting configuration could not be completed. Check the Vercel project and token permissions.");
    return response.json();
  }
  const project = await vercel(`/v9/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}${suffix}`);
  if (project.id !== VERCEL_PROJECT_ID || typeof project.name !== "string" || !project.name || project.link?.type !== "github" || !project.link.repoId || project.link.repo !== "ponsplit" || project.link.org !== "furkan3152") throw new Error("The Vercel project is not linked to furkan3152/ponsplit.");
  const environment = await vercel(`/v10/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/env${suffix}${suffix ? "&" : "?"}upsert=true`, {
    method: "POST", body: JSON.stringify(Object.entries(values).map(([key, value]) => ({ key, value, type: "plain", target: ["production"] }))),
  }).catch(() => null);
  if (!environment) return { applied: false as const, environmentUpdated: null, message: "Vercel did not confirm the environment update. Some public values may have been saved. Check both addresses in Vercel before redeploying." };
  const savedKeys = Array.isArray(environment.created) ? publicKeys.filter((key) => environment.created.some((entry: { key?: unknown }) => entry?.key === key)) : [];
  const failedKeys = publicKeys.filter((key) => !savedKeys.includes(key) || (Array.isArray(environment.failed) && environment.failed.some((entry: { key?: unknown }) => entry?.key === key)));
  if (failedKeys.length || !Array.isArray(environment.failed) || environment.failed.length) {
    return { applied: false as const, environmentUpdated: false, savedKeys, failedKeys, message: "Vercel saved only part of the public configuration, or could not confirm it. Check both addresses in Vercel. No rebuild was requested." };
  }
  // Rebuild the currently running commit when Vercel supplies it; avoid a moving branch tip.
  const currentCommit = process.env.VERCEL_GIT_COMMIT_SHA;
  const ref = currentCommit && /^[a-f0-9]{40}$/i.test(currentCommit) ? currentCommit : "claude/split-robinhood-version-d6nsuj";
  const deployment = await vercel(`/v13/deployments${suffix}`, {
    method: "POST", body: JSON.stringify({ name: project.name, project: VERCEL_PROJECT_ID, target: "production", gitSource: { type: "github", repoId: project.link.repoId, ref } }),
  }).catch(() => null);
  if (typeof deployment?.id !== "string" || !deployment.id) return { applied: false as const, environmentUpdated: true, savedKeys, message: "The public values were saved to Vercel, but a rebuild could not be confirmed. Check Vercel deployments and redeploy if needed before launching tokens." };
  const deploymentUrl = typeof deployment.url === "string" && /^[a-z0-9.-]+\.vercel\.app$/i.test(deployment.url) ? `https://${deployment.url}` : undefined;
  return { applied: true as const, environmentUpdated: true, savedKeys, deployment: { id: deployment.id, ...(deploymentUrl ? { url: deploymentUrl } : {}) }, message: "Verified public addresses saved. A Vercel production rebuild has started; wait for its health checks before launching." };
}

export function validVerifier(value: string): PublicKey {
  const key = new PublicKey(value);
  if (key.equals(PublicKey.default) || !PublicKey.isOnCurve(key.toBytes())) throw new Error("Use the admin public key for manual video review, or a managed on-curve verifier for OAuth.");
  return key;
}
