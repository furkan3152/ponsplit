import "server-only";
import { adminAuthReady } from "./admin-auth";
import { ADMIN_WALLET } from "./admin-config";
import { automaticConfigurationReady, configuredProgramStatus, serverEscrowArtifact, validVerifier, VERCEL_PROJECT_ID } from "./admin-setup";
import { PLATFORM_BPS, TREASURY } from "./solana/config";
import { getAttestationConfig, getTikTokOAuthConfig } from "./tiktok-auth";
import { ESCROW_PROGRAM_ID, VERIFIER, usesManualCreatorProof } from "./tiktok-config";

/** Public readiness only: no credentials, tokens, private wallet/session data or RPC URLs. */
export async function runtimeStatus() {
  let rpcError: string | undefined;
  let chain = { deployed: null as boolean | null, upgradeAuthority: null as string | null, artifactMatches: null as boolean | null };
  if (ESCROW_PROGRAM_ID) chain = await configuredProgramStatus(ESCROW_PROGRAM_ID).catch(() => { rpcError = "Program status could not be confirmed on Solana mainnet."; return chain; });
  const artifactAvailable = await serverEscrowArtifact().then(() => true, () => false);
  const oauth = Boolean(getTikTokOAuthConfig());
  const signer = Boolean(getAttestationConfig());
  const storage = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.PINATA_JWT);
  const manual = usesManualCreatorProof();
  let verifierConfigured = false;
  try { verifierConfigured = Boolean(VERIFIER && validVerifier(VERIFIER.toBase58()) && (!ESCROW_PROGRAM_ID || !VERIFIER.equals(ESCROW_PROGRAM_ID))); } catch { /* Invalid configuration remains disabled. */ }
  const remainingSetup = [
    !ESCROW_PROGRAM_ID || chain.artifactMatches !== true ? "Deploy and verify the escrow program" : "",
    !verifierConfigured ? "Configure the verification wallet" : "",
    !manual && !oauth ? "Connect approved TikTok Login Kit" : "",
    !manual && !signer ? "Connect the attestation signer" : "",
    !storage ? "Connect durable metadata storage" : "",
    !TREASURY?.equals(ADMIN_WALLET) || PLATFORM_BPS !== 2000 ? "Restore the fixed admin platform wallet and 20/80 fee policy" : "",
  ].filter(Boolean);
  return {
    admin: ADMIN_WALLET.toBase58(), platformBps: PLATFORM_BPS, network: "mainnet" as const,
    verificationMode: manual ? "video" as const : "oauth" as const,
    launchesReady: Boolean(chain.artifactMatches === true && artifactAvailable && storage && verifierConfigured && TREASURY?.equals(ADMIN_WALLET) && PLATFORM_BPS === 2000 && (manual || (oauth && signer))),
    configuration: { escrowProgram: { address: ESCROW_PROGRAM_ID?.toBase58() ?? null, configured: Boolean(ESCROW_PROGRAM_ID), ...chain }, verifier: { address: VERIFIER?.toBase58() ?? null, configured: verifierConfigured }, oauth, signer, storage, adminAuth: adminAuthReady() },
    deployment: { artifactAvailable, configuredProgram: ESCROW_PROGRAM_ID?.toBase58() ?? null, remainingSetup },
    site: { provider: "vercel", projectId: VERCEL_PROJECT_ID, automatedConfiguration: automaticConfigurationReady(), published: Boolean(process.env.VERCEL) },
    ...(rpcError ? { rpcError } : {}),
  };
}
