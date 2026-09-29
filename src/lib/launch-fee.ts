import "server-only";
import { isHash, type Address, type Hash, type PublicClient } from "viem";
import { launcherAbi } from "./abi";
import type { Network } from "./networks";

/**
 * How far back a launch fee payment may be: the RPC answers log queries over at most 1M blocks,
 * about a day on Robinhood Chain. An older unused payment is paid again.
 */
const MAX_AGE_BLOCKS = 900_000n;

export class LaunchFeeError extends Error {
  constructor(
    message: string,
    /**
     * "missing": no payment given; "pending": not on the chain (yet); "used": it already paid for a
     * launch (or is too old); "invalid": not a successful fee payment by this creator.
     */
    readonly code: "missing" | "pending" | "used" | "invalid"
  ) {
    super(message);
  }
}

/**
 * Checks that `hash` is `creator`'s payment of the network's launch fee and that no launch by
 * `creator` has happened since it (each payment covers one launch). Throws a LaunchFeeError when it
 * doesn't hold; does nothing when the network charges no fee.
 */
export async function checkLaunchFee(c: PublicClient, n: Network, creator: Address, hash: string | undefined): Promise<void> {
  const fee = n.launchFee;
  if (!fee) return;
  if (!hash) throw new LaunchFeeError("Pay the launch fee first.", "missing");
  if (!isHash(hash)) throw new LaunchFeeError("That isn't a transaction hash.", "invalid");
  const [tx, receipt, head] = await Promise.all([
    c.getTransaction({ hash: hash as Hash }).catch(() => null),
    c.getTransactionReceipt({ hash: hash as Hash }).catch(() => null),
    c.getBlockNumber(),
  ]);
  if (!tx || !receipt) throw new LaunchFeeError("The launch fee payment isn't on the chain yet. Try again in a moment.", "pending");
  if (receipt.status !== "success") throw new LaunchFeeError("The launch fee payment failed.", "invalid");
  if (tx.from.toLowerCase() !== creator.toLowerCase()) throw new LaunchFeeError("The launch fee was paid from another wallet.", "invalid");
  if (tx.to?.toLowerCase() !== fee.to.toLowerCase() || tx.value < fee.wei) throw new LaunchFeeError("That transaction isn't the launch fee.", "invalid");
  if (head - receipt.blockNumber > MAX_AGE_BLOCKS) throw new LaunchFeeError("That launch fee payment is too old.", "used");

  // Any launch by this creator from the payment's block on used it up.
  const launched = await c.getContractEvents({
    address: [...n.launchers],
    abi: launcherAbi,
    eventName: "Launched",
    args: { creator },
    fromBlock: receipt.blockNumber,
    toBlock: head,
  });
  if (launched.length) throw new LaunchFeeError("That launch fee already paid for a launch.", "used");
}
