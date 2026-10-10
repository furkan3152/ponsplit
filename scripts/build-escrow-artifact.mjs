// Build a reproducible public program artifact. No deployment key is kept.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const project = join(root, "programs/tiktok-escrow");
const binary = join(project, "target/deploy/tiktok_escrow.so");
const generatedKey = join(project, "target/deploy/tiktok_escrow-keypair.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceFiles = ["Cargo.lock", "Cargo.toml", ...readdirSync(join(project, "src")).filter((f) => f.endsWith(".rs")).map((f) => `src/${f}`)].sort();
function sourceHash() {
  const hash = createHash("sha256");
  for (const file of sourceFiles) hash.update(file).update("\0").update(readFileSync(join(project, file))).update("\0");
  return hash.digest("hex");
}
const before = sourceHash();
try {
  const result = spawnSync("cargo", ["build-sbf", "--manifest-path", join(project, "Cargo.toml"), "--", "--locked"], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`SBF build failed (${result.status})`);
} finally {
  // cargo-build-sbf generates a random key by default. It is never read, used or published.
  rmSync(generatedKey, { force: true });
}
if (before !== sourceHash()) throw new Error("Program source changed during the build; rebuild the artifact.");
const bytes = readFileSync(binary);
if (bytes.length > 256 * 1024 || bytes.length < 64 || bytes.subarray(0, 4).toString("hex") !== "7f454c46") throw new Error("Invalid SBF artifact");
const manifest = {
  version: 1,
  name: "tiktok-escrow",
  byteLength: bytes.length,
  sha256: sha256(bytes),
  sourceSha256: before,
  sourceFiles: sourceFiles.map((file) => relative(root, join(project, file))),
  compiler: "Solana CLI 2.3.13 / platform-tools 1.48 / Rust 1.84.1",
  vaultLayout: "TIKVAULT:138:v1",
  pendingVaultLayout: "TIKAPPRV:138:v1",
  proofLayout: "TIKPROOF:143:v1",
  proofApproval: "sha256-reviewed-account:creator-activation:v1",
};
const destination = join(root, "public/programs");
mkdirSync(destination, { recursive: true });
writeFileSync(join(destination, "tiktok-escrow.so"), bytes, { mode: 0o644 });
writeFileSync(join(destination, "tiktok-escrow.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Escrow artifact: ${bytes.length} bytes; SHA256 ${manifest.sha256}`);
