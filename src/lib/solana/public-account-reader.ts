import { PUBLIC_INDEX_RPC } from "./rpc";

type ScanRequest = { jsonrpc: string; id: unknown; method: string; params: unknown[] };
type ReadOptions = {
  deadline?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export class PublicAccountReadError extends Error {
  readonly attempts: number;
  readonly status?: number;
  readonly rpcCode?: number;
  readonly retryAfterSeconds: number;
  constructor(
    attempts: number, status?: number, rpcCode?: number, retryAfterSeconds = 5,
  ) {
    super("Public account scan unavailable");
    this.attempts = attempts;
    this.status = status;
    this.rpcCode = rpcCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function retryDelay(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}

/** Read-only, bounded retries. Every call reads again; never substitutes cached or empty accounts. */
export async function readPublicProgramAccounts(request: ScanRequest, options: ReadOptions = {}): Promise<unknown[]> {
  if (request.jsonrpc !== "2.0" || request.method !== "getProgramAccounts") {
    throw new Error("Only getProgramAccounts reads are supported.");
  }
  const now = options.now ?? Date.now;
  const deadline = options.deadline ?? now() + 25_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let failure = new PublicAccountReadError(0);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const remaining = deadline - now();
    if (remaining < 500) throw failure;
    let retry = true;
    let delay = attempt === 1 ? 1_500 : 3_000;
    try {
      const upstream = await fetchImpl(PUBLIC_INDEX_RPC, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request),
        cache: "no-store", signal: AbortSignal.timeout(Math.min(5_000, remaining)),
      });
      const advisedDelay = retryDelay(upstream.headers.get("retry-after"), now());
      if (advisedDelay !== undefined) delay = Math.max(delay, advisedDelay);
      failure = new PublicAccountReadError(attempt, upstream.status, undefined, Math.max(5, Math.ceil(delay / 1_000)));
      if (!upstream.ok) {
        retry = upstream.status === 408 || upstream.status === 429 || upstream.status >= 500;
        await upstream.body?.cancel();
      } else {
        const result = await upstream.json();
        if (result?.error) {
          const code = typeof result.error.code === "number" ? result.error.code : undefined;
          const message = typeof result.error.message === "string" ? result.error.message : "";
          retry = code !== -32601 && code !== -32602 && (
            [-32004, -32005, -32429, 429].includes(code ?? 0)
            || /rate limit|too many requests|temporarily unavailable|node is unhealthy/i.test(message)
          );
          failure = new PublicAccountReadError(attempt, upstream.status, code, Math.max(5, Math.ceil(delay / 1_000)));
        } else if (result?.jsonrpc === "2.0" && result.id === request.id && Array.isArray(result.result)) {
          return result.result;
        } else {
          // A mismatched/malformed response cannot prove which accounts belong to the program.
          retry = false;
        }
      }
    } catch {
      // Transport, timeout and invalid-JSON failures are temporary reads, never transaction retries.
      failure = new PublicAccountReadError(attempt);
    }
    if (!retry || attempt === 3 || deadline - now() < delay + 500) throw failure;
    await sleep(delay);
  }
  throw failure;
}
