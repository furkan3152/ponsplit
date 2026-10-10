import { SendTransactionError, VersionedTransaction, type Connection } from "@solana/web3.js";
import bs58 from "bs58";

type SendingConnection = Pick<Connection, "sendRawTransaction" | "getSignatureStatuses">;

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Solana RPC response timed out.")), milliseconds); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class VersionedTransactionFailedError extends Error {
  readonly signature: string;
  constructor(signature: string, chainError?: unknown) {
    super(`The transaction was rejected on Solana${chainError ? `: ${JSON.stringify(chainError)}` : ""}. Transaction: ${signature}. Check its receipt before retrying.`);
    this.name = "VersionedTransactionFailedError";
    this.signature = signature;
  }
}

export class VersionedTransactionPreflightError extends Error {
  readonly signature: string;
  constructor(signature: string, diagnostic: string) {
    super(`${diagnostic} The RPC rejected this transaction before submission. Transaction: ${signature}.`);
    this.name = "VersionedTransactionPreflightError";
    this.signature = signature;
  }
}

/** A refreshed wallet hash has no trusted height. Confirm the exact signed ID instead. */
export async function confirmVersionedSignature(
  connection: Pick<Connection, "getSignatureStatuses">,
  signature: string,
  timeoutMilliseconds = 60_000,
): Promise<void> {
  const deadline = Date.now() + Math.max(0, Math.min(timeoutMilliseconds, 90_000));
  do {
    const result = await within(connection.getSignatureStatuses([signature], { searchTransactionHistory: true }), Math.max(1, Math.min(10_000, deadline - Date.now()))).catch(() => null);
    const status = result?.value[0];
    if (status?.err) throw new VersionedTransactionFailedError(signature, status.err);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(1_500, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new Error(`Solana has not confirmed this transaction yet. Transaction: ${signature}. Check its receipt before retrying.`);
}

/** Call only with a checked wallet signature. Save its ID before any network submission. */
export async function sendCheckedVersionedTransaction(
  connection: SendingConnection,
  transaction: VersionedTransaction,
  onSent?: (signature: string) => void,
  timeoutMilliseconds = 60_000,
): Promise<string> {
  // Own a wire copy; an adapter cannot change bytes while an RPC call is pending.
  const signed = VersionedTransaction.deserialize(transaction.serialize());
  const signatureBytes = signed.signatures[0];
  if (!signatureBytes || signatureBytes.length !== 64 || !signatureBytes.some((byte) => byte !== 0)) {
    throw new Error("The wallet did not sign the transaction. No transaction was submitted.");
  }
  const signature = bs58.encode(signatureBytes);
  onSent?.(signature);
  let submissionError: unknown;
  try {
    const returned = await within(connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "processed",
      maxRetries: 3,
    }), 30_000);
    if (returned !== signature) throw new Error("RPC returned a different transaction signature.");
  } catch (error) {
    // A mobile HTTP connection can fail after the write landed. Reconcile the
    // signed transaction ID before reporting uncertainty, never submit a second tx.
    submissionError = error;
  }
  if (submissionError instanceof SendTransactionError && submissionError.logs) {
    const result = await within(connection.getSignatureStatuses([signature], { searchTransactionHistory: true }), 10_000).catch(() => null);
    const status = result?.value[0];
    if (status?.err) throw new VersionedTransactionFailedError(signature, status.err);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
    // A successful read with no signature and a definite simulation error is a
    // pre-submission rejection. An unavailable/processed status stays uncertain.
    if (result && status === null) throw new VersionedTransactionPreflightError(signature, submissionError.message);
  }
  try {
    await confirmVersionedSignature(connection, signature, timeoutMilliseconds);
  } catch (error) {
    if (error instanceof VersionedTransactionFailedError || !submissionError) throw error;
    const diagnostic = submissionError instanceof Error ? submissionError.message : String(submissionError);
    throw new Error(`${diagnostic} ${error instanceof Error ? error.message : String(error)}`);
  }
  return signature;
}
