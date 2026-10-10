import { ComputeBudgetProgram, Message, Transaction, type Signer } from "@solana/web3.js";
import bs58 from "bs58";

/** A wallet may refresh its blockhash/select a small fee, never change deployment intent. */
export const MAX_WALLET_PRIORITY_FEE_LAMPORTS = 5_000n;
const COMPUTE = ComputeBudgetProgram.programId.toBase58();

export function assertDeploymentMessage(expectedBytes: Uint8Array, returned: Transaction): void {
  const expected = Message.from(expectedBytes);
  const actual = returned.compileMessage();
  const fail = (detail: string): never => { throw new Error(`Wallet transaction blocked: ${detail}. No transaction was submitted.`); };
  if (!expected.accountKeys[0].equals(actual.accountKeys[0])) fail("fee payer changed");
  // A refreshed blockhash changes transaction lifetime, not the authorized loader operation.
  // Its signature is checked below and RPC preflight validates the actual signed blockhash.
  if (expected.header.numRequiredSignatures !== actual.header.numRequiredSignatures) fail("required signers changed");
  const accounts = (message: Message) => message.accountKeys.map((key, i) => ({ key: key.toBase58(), signer: message.isAccountSigner(i), writable: message.isAccountWritable(i) })).filter(a => a.key !== COMPUTE).sort((a, b) => a.key.localeCompare(b.key));
  if (JSON.stringify(accounts(expected)) !== JSON.stringify(accounts(actual))) fail("accounts or account permissions changed");
  const core = (message: Message) => message.instructions.filter(ix => message.accountKeys[ix.programIdIndex].toBase58() !== COMPUTE).map(ix => ({ program: message.accountKeys[ix.programIdIndex].toBase58(), accounts: ix.accounts.map(i => message.accountKeys[i].toBase58()), data: ix.data }));
  if (JSON.stringify(core(expected)) !== JSON.stringify(core(actual))) fail("an instruction, recipient, authority or program data changed");
  let units = 1_400_000n, price = 0n;
  const seen = new Set<number>();
  for (const ix of actual.instructions) {
    if (actual.accountKeys[ix.programIdIndex].toBase58() !== COMPUTE) continue;
    if (actual.isAccountSigner(ix.programIdIndex) || actual.isAccountWritable(ix.programIdIndex) || ix.accounts.length) fail("invalid fee instruction accounts");
    const data = Buffer.from(bs58.decode(ix.data));
    const tag = data[0];
    if (seen.has(tag)) fail("duplicate fee instructions");
    seen.add(tag);
    if (tag === 2 && data.length === 5) {
      units = BigInt(data.readUInt32LE(1));
      if (units < 1n || units > 1_400_000n) fail("invalid compute limit");
    } else if (tag === 3 && data.length === 9) price = data.readBigUInt64LE(1);
    else fail("unsupported fee instruction");
  }
  const priorityFee = (units * price + 999_999n) / 1_000_000n;
  if (priorityFee > MAX_WALLET_PRIORITY_FEE_LAMPORTS) fail("wallet priority fee exceeds 0.000005 SOL per transaction; lower the wallet priority fee");
}

export function checkedDeploymentSignature(expectedBytes: Uint8Array, returned: Transaction, lastValidBlockHeight?: number, ephemeralSigners: readonly Signer[] = []): Transaction {
  // Own an immutable wire snapshot: adapters may mutate the input or return that same object.
  const signed = Transaction.from(returned.serialize({ requireAllSignatures: false, verifySignatures: false }));
  assertDeploymentMessage(expectedBytes, signed);
  const expected = Message.from(expectedBytes);
  const payer = expected.accountKeys[0];
  if (!signed.signatures.find(s => s.publicKey.equals(payer))?.signature) throw new Error("The wallet did not sign the deployment transaction. No transaction was submitted.");
  // Only the locally generated buffer/program keys can be refreshed. Never sign for the admin.
  for (const signer of ephemeralSigners) {
    const index = expected.accountKeys.findIndex(key => key.equals(signer.publicKey));
    if (index < 1 || !expected.isAccountSigner(index)) throw new Error("Unexpected deployment co-signer.");
    const entry = signed.signatures.find(s => s.publicKey.equals(signer.publicKey));
    if (entry) entry.signature = null;
  }
  // Verify the owner's approval of the exact returned message BEFORE adding local co-signatures.
  signed.serialize({ requireAllSignatures: false, verifySignatures: true });
  if (ephemeralSigners.length) signed.partialSign(...ephemeralSigners);
  signed.serialize({ requireAllSignatures: true, verifySignatures: true });
  // An old block-height expiry belongs only to the old hash. Ignore wallet-supplied metadata.
  signed.lastValidBlockHeight = signed.recentBlockhash === expected.recentBlockhash ? lastValidBlockHeight : undefined;
  return signed;
}
