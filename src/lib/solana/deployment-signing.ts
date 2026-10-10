import { ComputeBudgetProgram, Message, type Transaction } from "@solana/web3.js";
import bs58 from "bs58";

/** A wallet may select a small priority fee, never add transfers or change deployment instructions. */
export const MAX_WALLET_PRIORITY_FEE_LAMPORTS = 5_000n;
const COMPUTE = ComputeBudgetProgram.programId.toBase58();

export function assertDeploymentMessage(expectedBytes: Uint8Array, returned: Transaction): void {
  const expected = Message.from(expectedBytes);
  const actual = returned.compileMessage();
  const fail = (detail: string): never => { throw new Error(`Wallet transaction blocked: ${detail}. Use normal fee mode in OKX; disable Express / extra tips. No changed transaction was submitted.`); };
  if (!expected.accountKeys[0].equals(actual.accountKeys[0])) fail("fee payer changed");
  if (expected.recentBlockhash !== actual.recentBlockhash) fail("recent blockhash changed; retry with a fresh signature");
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
  if (priorityFee > MAX_WALLET_PRIORITY_FEE_LAMPORTS) fail("wallet priority fee exceeds 0.000005 SOL per transaction");
}

export function checkedDeploymentSignature(expectedBytes: Uint8Array, returned: Transaction, lastValidBlockHeight?: number): Transaction {
  assertDeploymentMessage(expectedBytes, returned);
  // Includes the admin and any ephemeral buffer/program signer. Altering a partial signature fails.
  returned.serialize({ requireAllSignatures: true, verifySignatures: true });
  returned.lastValidBlockHeight = lastValidBlockHeight;
  return returned;
}
