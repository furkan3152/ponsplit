import { ComputeBudgetProgram, MessageV0, VersionedTransaction, type Signer } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";

const COMPUTE = ComputeBudgetProgram.programId.toBase58();
const MAX_ADDED_WALLET_PRIORITY_FEE = 5_000n;
const fail = (reason: string): never => {
  throw new Error(`Wallet transaction blocked: ${reason}. No changed transaction was submitted.`);
};

function staticMessage(message: VersionedTransaction["message"]): MessageV0 {
  if (message.version !== 0 || message.addressTableLookups.length) {
    return fail("unsupported transaction version or address lookup table");
  }
  return message;
}

function priorityFee(message: MessageV0): bigint {
  const coreCount = message.compiledInstructions.filter(ix => message.staticAccountKeys[ix.programIdIndex].toBase58() !== COMPUTE).length;
  // Without an explicit limit, the runtime allocates up to 200k CU per instruction,
  // capped at 1.4m. All current pump/escrow builders use static account keys.
  let units = BigInt(Math.min(coreCount * 200_000, 1_400_000));
  let price = 0n;
  const seen = new Set<number>();
  for (const instruction of message.compiledInstructions) {
    if (message.staticAccountKeys[instruction.programIdIndex].toBase58() !== COMPUTE) continue;
    if (message.isAccountSigner(instruction.programIdIndex) || message.isAccountWritable(instruction.programIdIndex) || instruction.accountKeyIndexes.length) {
      fail("invalid fee instruction accounts");
    }
    const data = Buffer.from(instruction.data);
    const tag = data[0];
    if (seen.has(tag)) fail("duplicate fee instructions");
    seen.add(tag);
    if (tag === 2 && data.length === 5) {
      units = BigInt(data.readUInt32LE(1));
      if (units < 1n || units > 1_400_000n) fail("invalid compute limit");
    } else if (tag === 3 && data.length === 9) {
      price = data.readBigUInt64LE(1);
    } else fail("unsupported fee instruction");
  }
  return (units * price + 999_999n) / 1_000_000n;
}

/** Hash refreshes and bounded fee selection must never alter the approved operation.
 * Existing pump transactions request up to 20,000 lamports priority fee; preserve their
 * original allowance rather than applying the smaller escrow-only allowance globally.
 */
export function assertVersionedMessage(expectedBytes: Uint8Array, returned: VersionedTransaction): void {
  const expected = staticMessage(MessageV0.deserialize(expectedBytes));
  const actual = staticMessage(returned.message);
  if (!expected.staticAccountKeys[0].equals(actual.staticAccountKeys[0])) fail("fee payer changed");
  if (expected.header.numRequiredSignatures !== actual.header.numRequiredSignatures) fail("required signers changed");
  const accounts = (message: MessageV0) => message.staticAccountKeys.map((key, index) => ({
    key: key.toBase58(), signer: message.isAccountSigner(index), writable: message.isAccountWritable(index),
  })).filter(account => account.key !== COMPUTE).sort((a, b) => a.key.localeCompare(b.key));
  if (JSON.stringify(accounts(expected)) !== JSON.stringify(accounts(actual))) fail("accounts or account permissions changed");
  const core = (message: MessageV0) => message.compiledInstructions
    .filter(ix => message.staticAccountKeys[ix.programIdIndex].toBase58() !== COMPUTE)
    .map(ix => ({
      program: message.staticAccountKeys[ix.programIdIndex].toBase58(),
      accounts: ix.accountKeyIndexes.map(index => message.staticAccountKeys[index].toBase58()),
      data: Buffer.from(ix.data).toString("hex"),
    }));
  if (JSON.stringify(core(expected)) !== JSON.stringify(core(actual))) fail("an instruction, recipient, authority or program data changed");
  const originalFee = priorityFee(expected);
  const maximum = originalFee > MAX_ADDED_WALLET_PRIORITY_FEE ? originalFee : MAX_ADDED_WALLET_PRIORITY_FEE;
  if (priorityFee(actual) > maximum) fail(`wallet priority fee exceeds the approved ${maximum.toString()} lamport limit`);
}

function verifySignature(transaction: VersionedTransaction, index: number): void {
  const signature = transaction.signatures[index];
  if (!signature || signature.length !== 64 || !signature.some(byte => byte !== 0)) {
    fail("a required wallet signature is missing");
  }
  // Bundled verification works in mobile WebViews without WebCrypto Ed25519 support.
  // Strict RFC8032 verification also rejects noncanonical/small-order signing keys.
  const verified = ed25519.verify(signature, transaction.message.serialize(), transaction.message.staticAccountKeys[index].toBytes(), { zip215: false });
  if (!verified) fail("signature verification failed");
}

/** Snapshot a returned v0 transaction and verify the wallet's exact signed message before
 * refreshing only explicitly supplied local co-signatures (for example a new mint).
 * No owner key is supplied, stored or generated here.
 */
export async function checkedVersionedSignature(expectedBytes: Uint8Array, returned: VersionedTransaction, ephemeralSigners: readonly Signer[] = []): Promise<VersionedTransaction> {
  const bytes = returned.serialize();
  if (bytes.length > 1232) fail("transaction exceeds Solana's packet limit");
  const signed = VersionedTransaction.deserialize(bytes);
  assertVersionedMessage(expectedBytes, signed);
  const expected = staticMessage(MessageV0.deserialize(expectedBytes));
  const localKeys = new Set<string>();
  for (const signer of ephemeralSigners) {
    const index = expected.staticAccountKeys.findIndex(key => key.equals(signer.publicKey));
    const address = signer.publicKey.toBase58();
    if (index < 1 || !expected.isAccountSigner(index) || localKeys.has(address)) fail("unexpected local co-signer");
    localKeys.add(address);
  }
  // Verify every nonlocal signer before using a temporary mint key on the new message.
  for (let index = 0; index < signed.message.header.numRequiredSignatures; index++) {
    if (!localKeys.has(signed.message.staticAccountKeys[index].toBase58())) verifySignature(signed, index);
  }
  if (ephemeralSigners.length) signed.sign([...ephemeralSigners]);
  for (let index = 0; index < signed.message.header.numRequiredSignatures; index++) verifySignature(signed, index);
  return signed;
}
