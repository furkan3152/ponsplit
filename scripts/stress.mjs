// Load test for the live site and the chain's RPC, from one machine (the stress.yml runner).
// Nothing is signed or sent on-chain. Phases:
//   1. pages  — the public pages and a coin page, many at once (what Vercel serves)
//   2. apis   — the read APIs the pages call (config, X lookups; their per-client limits answer 429
//               by design, since every request here comes from one IP)
//   3. rpc    — a burst of reads against the chain RPC the browsers use (public or paid)
// Prints latency percentiles, status counts and errors per phase; exits non-zero on 5xx or
// timeouts from the site.
//
//   SITE=https://splitearn.app RPC=https://rpc.mainnet.chain.robinhood.com COIN=0x… \
//   CONCURRENCY=40 REQUESTS=600 node scripts/stress.mjs
const SITE = (process.env.SITE || "https://splitearn.app").replace(/\/$/, "");
const RPC = process.env.RPC || "https://rpc.mainnet.chain.robinhood.com";
const COIN = process.env.COIN || "";
const CONCURRENCY = Number(process.env.CONCURRENCY || 40);
const REQUESTS = Number(process.env.REQUESTS || 600);
const TIMEOUT = 20_000;

const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : 0);

async function run(name, total, concurrency, make) {
  const times = [];
  const statuses = new Map();
  const errors = new Map();
  let next = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < total) {
      const i = next++;
      const t0 = performance.now();
      try {
        const res = await make(i);
        statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
        await res.arrayBuffer();
      } catch (e) {
        const k = String(e?.name === "TimeoutError" ? "timeout" : e?.cause?.code || e?.message || e).slice(0, 60);
        errors.set(k, (errors.get(k) ?? 0) + 1);
      }
      times.push(performance.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const secs = (Date.now() - started) / 1000;
  times.sort((a, b) => a - b);
  const r = (n) => Math.round(n);
  console.log(
    `\n[${name}] ${total} requests, ${concurrency} at a time, ${secs.toFixed(1)} s (${(total / secs).toFixed(1)} req/s)\n` +
      `  latency ms: p50 ${r(pct(times, 50))}  p90 ${r(pct(times, 90))}  p99 ${r(pct(times, 99))}  max ${r(times.at(-1) ?? 0)}\n` +
      `  status: ${[...statuses].map(([s, n]) => `${s}×${n}`).join("  ") || "-"}` +
      (errors.size ? `\n  errors: ${[...errors].map(([e, n]) => `${e}×${n}`).join("  ")}` : "")
  );
  return { statuses, errors };
}

const get = (path) => fetch(SITE + path, { signal: AbortSignal.timeout(TIMEOUT), headers: { "user-agent": "splitearn-stress/1" } });
const pages = ["/", "/explore", "/create", "/claim", "/how", "/me", ...(COIN ? [`/token/${COIN}`] : [])];
const results = [];

// 1. Pages: every page, many times over, with the network cookie alternating like real visitors.
results.push(
  await run("pages", REQUESTS, CONCURRENCY, (i) =>
    fetch(SITE + pages[i % pages.length], {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { cookie: `pe-network=${i % 2 ? "testnet" : "mainnet"}`, "user-agent": "splitearn-stress/1" },
    })
  )
);

// 2. APIs the browser calls. /api/config is cheap; the X lookup hits fxtwitter behind per-client
// budgets, so a modest number here (a burst from one IP must be answered with 429s, not 5xx).
results.push(await run("api/config", Math.round(REQUESTS / 2), CONCURRENCY, () => get("/api/config")));
const handles = ["jack", "x", "naval", "elonmusk", "robinhoodapp", "vitalikbuterin"];
results.push(await run("api/x/resolve", 60, 10, (i) => get(`/api/x/resolve?handles=${handles[i % handles.length]}`)));
// The shared chain snapshots every page reads (cached by the CDN for a few seconds).
results.push(await run("api/snapshot", 200, 40, (i) => get(`/api/snapshot?network=${i % 2 ? "testnet" : "mainnet"}`)));
if (COIN) results.push(await run("api/trades", 100, 20, () => get(`/api/trades?network=mainnet&token=${COIN}`)));
// Coin share cards render server-side from the chain.
if (COIN) results.push(await run("coin share card", 40, 10, () => get(`/token/${COIN}/opengraph-image`)));

// 3. The chain RPC: what one busy browser session sends (batched reads, logs).
const body = (i) =>
  JSON.stringify(
    i % 5 === 0
      ? { jsonrpc: "2.0", id: i, method: "eth_getLogs", params: [{ fromBlock: "latest", toBlock: "latest" }] }
      : i % 5 === 1
        ? [1, 2, 3, 4, 5].map((k) => ({ jsonrpc: "2.0", id: i * 10 + k, method: "eth_blockNumber", params: [] }))
        : { jsonrpc: "2.0", id: i, method: i % 2 ? "eth_blockNumber" : "eth_gasPrice", params: [] }
  );
const rpcRes = await run("rpc", REQUESTS, CONCURRENCY, (i) =>
  fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: body(i), signal: AbortSignal.timeout(TIMEOUT) })
);

// Verdict: the site must never answer 5xx or time out; the RPC's 429s are reported, not fatal.
const siteBad = results.reduce(
  (n, r) => n + [...r.statuses].filter(([s]) => s >= 500).reduce((a, [, c]) => a + c, 0) + [...r.errors.values()].reduce((a, c) => a + c, 0),
  0
);
const rpc429 = rpcRes.statuses.get(429) ?? 0;
console.log(`\nSITE: ${siteBad ? `${siteBad} failed responses (5xx / timeouts / network)` : "no 5xx, no timeouts"}`);
console.log(`RPC: ${rpc429} rate-limited (429) of ${REQUESTS}; ${[...rpcRes.errors.values()].reduce((a, c) => a + c, 0)} network errors`);
if (siteBad) process.exit(1);
