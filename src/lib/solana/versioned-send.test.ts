import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, SendTransactionError, SystemProgram, TransactionMessage, VersionedTransaction, type Connection, type SignatureStatus } from "@solana/web3.js";
import bs58 from "bs58";
import { confirmVersionedSignature, sendCheckedVersionedTransaction, VersionedTransactionFailedError, VersionedTransactionPreflightError } from "./versioned-send";

function fixture() {
  const payer = Keypair.generate(); // Disposable local-test identity only.
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
  }).compileToV0Message());
  transaction.sign([payer]);
  return { transaction, signature: bs58.encode(transaction.signatures[0]) };
}

const status = (value: Partial<SignatureStatus> | null) => ({ context: { slot: 1 }, value: [value && { slot: 1, confirmations: 1, err: null, ...value }] });

test("signed ID is saved before sending, actual hash preflight is processed, and only confirmed status succeeds", async () => {
  const { transaction, signature } = fixture();
  let saved = "";
  const connection = {
    sendRawTransaction: async (bytes: Uint8Array, options: unknown) => {
      assert.equal(saved, signature);
      assert.deepEqual(options, { skipPreflight: false, preflightCommitment: "processed", maxRetries: 3 });
      assert.equal(VersionedTransaction.deserialize(bytes).message.recentBlockhash, transaction.message.recentBlockhash);
      return signature;
    },
    getSignatureStatuses: async (signatures: string[]) => { assert.deepEqual(signatures, [signature]); return status({ confirmationStatus: "confirmed" }); },
  } as unknown as Pick<Connection, "sendRawTransaction" | "getSignatureStatuses">;
  assert.equal(await sendCheckedVersionedTransaction(connection, transaction, (id) => { saved = id; }, 0), signature);
});

test("lost send responses reconcile the original signed transaction without a second payment", async () => {
  const { transaction, signature } = fixture();
  let submissions = 0;
  const connection = {
    sendRawTransaction: async () => { submissions++; throw new Error("Connection lost after submission"); },
    getSignatureStatuses: async () => status({ confirmationStatus: "finalized" }),
  } as unknown as Pick<Connection, "sendRawTransaction" | "getSignatureStatuses">;
  assert.equal(await sendCheckedVersionedTransaction(connection, transaction, undefined, 0), signature);
  assert.equal(submissions, 1);
});

test("processed, missing, failed, and unavailable status never become a confirmed receipt", async () => {
  const { signature } = fixture();
  for (const value of [null, { confirmationStatus: "processed" as const }]) {
    const connection = { getSignatureStatuses: async () => status(value) } as unknown as Pick<Connection, "getSignatureStatuses">;
    await assert.rejects(() => confirmVersionedSignature(connection, signature, 0), /not confirmed/);
  }
  const failed = { getSignatureStatuses: async () => status({ err: { InstructionError: [0, "InvalidArgument"] } }) } as unknown as Pick<Connection, "getSignatureStatuses">;
  await assert.rejects(() => confirmVersionedSignature(failed, signature, 0), (error: unknown) => error instanceof VersionedTransactionFailedError && error.message.includes("InvalidArgument"));
  const offline = { getSignatureStatuses: async () => { throw new Error("RPC unavailable"); } } as unknown as Pick<Connection, "getSignatureStatuses">;
  await assert.rejects(() => confirmVersionedSignature(offline, signature, 0), /not confirmed/);
});

test("definite simulation rejection preserves its actionable reason and still checks the signed ID", async () => {
  const { transaction, signature } = fixture();
  let checked = false;
  const connection = {
    sendRawTransaction: async () => { throw new SendTransactionError({ action: "send", signature: "", transactionMessage: "insufficient funds for rent", logs: ["Program failed: insufficient funds"] }); },
    getSignatureStatuses: async (signatures: string[]) => { checked = true; assert.deepEqual(signatures, [signature]); return status(null); },
  } as unknown as Pick<Connection, "sendRawTransaction" | "getSignatureStatuses">;
  await assert.rejects(() => sendCheckedVersionedTransaction(connection, transaction), (error: unknown) => error instanceof VersionedTransactionPreflightError && error.message.includes("insufficient funds for rent") && error.signature === signature);
  assert.equal(checked, true);
});

test("unsigned transactions cannot be submitted or create a misleading receipt", async () => {
  const { transaction } = fixture();
  transaction.signatures[0].fill(0);
  let submitted = false;
  const connection = { sendRawTransaction: async () => { submitted = true; return ""; } } as unknown as Pick<Connection, "sendRawTransaction" | "getSignatureStatuses">;
  await assert.rejects(() => sendCheckedVersionedTransaction(connection, transaction), /did not sign/);
  assert.equal(submitted, false);
});
