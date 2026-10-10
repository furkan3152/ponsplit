/** A signed upload can contain many independent, non-overlapping buffer writes.
 * Stop scheduling on the first failure and drain in-flight requests before returning,
 * so Resume never races the previous upload. No new signatures or transactions are created here.
 */
export async function sendUploadQueue<T>(items: readonly T[], send: (item: T, index: number) => Promise<void>, concurrency = 3): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error("Invalid upload concurrency.");
  let next = 0;
  let failed = false;
  let failure: unknown;
  async function worker() {
    while (!failed && next < items.length) {
      const index = next++;
      try { await send(items[index], index); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failed) throw failure;
}
