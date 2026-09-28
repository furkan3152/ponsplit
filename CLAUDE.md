# PonSplit: working notes for Claude

The owner (GitHub: furkan3152) writes in Turkish, so answer in Turkish. They often work from a
phone and can't edit environments by hand. Keep instructions to taps and copy/paste.

## What this is

PonSplit is the Robinhood Chain version of usesplit.pro: a pump.fun-style launchpad where every
trade's fee is split between up to 10 X (Twitter) accounts.

- **Chain.** Robinhood Chain is an Arbitrum Orbit chain with ETH as gas. Testnet chainId is 46630,
  mainnet is 4663. RPCs: `https://rpc.testnet.chain.robinhood.com` and `https://rpc.mainnet.chain.robinhood.com`.
- **Bonding curve.** Virtual reserves are 1.5 ETH and 1.073B tokens. The curve sells 793.1M tokens.
  At about 4.25 ETH the coin graduates into a built-in PonSwap pool with 206.9M tokens and locked
  liquidity. The same buy/sell functions keep working after graduation.
- **Fees.** 1% per trade: 20% goes to the protocol and 80% to the X accounts, keyed by their
  permanent numeric X user id in FeeVault. Fee terms are snapshotted per token.
- **Signing.** A server key signs EIP-712 messages:
  - `SplitAttestation` for launches: username → id, bound to the creator.
  - `Claim` for payouts, bound to the destination wallet.
- **Proving account ownership.** Either X OAuth (next-auth, optional), or a proof post. A proof
  post must be a standalone post whose whole text is exactly `proofText(handle, wallet)`: the full
  wallet plus an HMAC code. Replies, quotes and substring matches are rejected. The post is read
  via api.fxtwitter.com.
- **X Money is intentionally NOT used.** The owner decided this. It has no API, is US-only and needs KYC.

Layout: `contracts/` holds Hardhat (SplitLaunchpad, FeeVault, SplitToken, plus test simulators).
The Next.js 14 app is at the repo root: `src/app`, `src/lib`, `src/components`. The Playwright
end-to-end suite is in `e2e/`. Docs are Turkish: README.md and MAINNET.md.

## Hard rules

- **Never generate, read, print or store private keys or seeds.** Not in chat, git, files or tool
  calls. The owner generates the admin key on `/setup` in their browser and pastes it into the host
  themselves. Render blueprints use `SIGNER_SEED: generateValue`.
- Develop on branch `claude/split-robinhood-version-d6nsuj`, which is also the default branch.
  Push only there. Don't open PRs unless asked.
- Commits end with the Co-Authored-By / Claude-Session trailers used in `git log`.

## Commands

```bash
cd contracts && npx hardhat test          # 27 tests (solc-js 0.8.24 via a compile subtask, viaIR)
cd contracts && node scripts/export-abi.js  # regenerate src/lib/abi.ts + bytecode.ts after any .sol change (CI checks they match)
npx tsc --noEmit && npx next lint && npm test   # web typecheck, lint, unit tests (src/lib/*.test.ts)
# local end-to-end: hardhat node on :8545, then build+start with
#   NEXT_PUBLIC_CHAIN=local SIGNER_SEED=<random> OWNER_ADDRESS=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 X_RESOLVER=mock
#   cd e2e && BASE=http://localhost:3000 node full.mjs      (16 checks; CI adds a real-X check → 17)
```

Gotchas:
- `pkill -f "[h]ardhat node"` kills your own shell if the same command line mentions that text
  again. Run pkill as its own command.
- Cloud containers can often only reach GitHub. To reach the chain, fxtwitter or any web page, run
  the `fetch.yml` (URLs) or `probe.yml` (chain, Multicall3, faucet, fxtwitter) workflows and read
  their logs.
- CI (`ci.yml`) runs these jobs:
  - contract tests plus an ABI/bytecode drift check
  - Slither
  - simulate.js and deep-simulate.js as a single `eth_call` against the real testnet and mainnet
  - web checks
  - e2e on a Hardhat fork of testnet, with a random admin seed per run

## Deployment state (last updated 2026-09-28)

- **Render.** Testnet service `ponsplit-testnet`, id `srv-dasv10bbc2fs73agp3sg`, workspace
  `tea-d7ccecdckfvc73887jo0`, Frankfurt, free plan, auto-deploys the branch. It is live at
  https://ponsplit-testnet.onrender.com. It was created through the Render API, not the blueprint,
  so it has no SIGNER_SEED: the owner set `SIGNER_PRIVATE_KEY` there themselves. That key was
  shared in chat, so treat it as public and testnet-only; mainnet gets a fresh key.
- **Testnet contracts are live**, deployed from `/setup` on 2026-09-28:
  - admin, signer and owner of both: `0x36b1f70cFcA2DB13aA43B0208f6979c5407099b9`
  - FeeVault `0x79729a008b26Fd1c3d50a9dF4ceD538B096380E5` (admin nonce 0)
  - SplitLaunchpad `0xB6404ab2d13808eFA3885ff05900aa9d59964cf3` (admin nonce 1)
  - Both are pinned on Render (`NEXT_PUBLIC_FEE_VAULT_ADDRESS`, `NEXT_PUBLIC_LAUNCHPAD_ADDRESS`).
  - Check them any time with the `inspect.yml` workflow: read-only, straight from the chain. With
    `site` it also simulates a launch through the live site (real attestation, eth_call only).
- **Contract changes are no longer free on testnet.** The live contracts can't be upgraded. A
  changed .sol needs a new deployment: a new admin key on `/setup` (it deploys at nonces 0/1 of a
  fresh key) or `deploy-testnet.yml`, then re-pin both addresses on Render. Coins launched on the
  old contracts stay there.
- **Mainnet** is not deployed. Use `render.mainnet.yaml` and follow MAINNET.md (audit, legal,
  multisig owner, OAuth, `NEXTAUTH_URL`, `X_BEARER_TOKEN`, pinned addresses).

## History / where things stand

- The full MVP is built:
  - launch, curve, graduation and pool
  - claims (proof post or OAuth)
  - charts and trade history read from the chain
  - one-tap `/setup`
  - a mixed Apple / pump.fun "chunky sticker" UI with light and dark themes and custom SVG art
- A deep multi-agent review found 44 real issues. They are all fixed in commit 605340b:
  - strict proof check
  - setup race fix with exact nonces
  - OG-image SSRF guard
  - body caps
  - rate-limit client IP
  - bounded X resolver
  - `creationFee` cap and `minTokensOut` on launch
  - `FeeVault.totalDeposited`
  - pinned addresses and key rotation
  - `formatPrice` fix
  - lists covering all coins
  - Multicall3
  - many UX fixes
- A second verification pass found 16 more issues (gaps in those fixes plus regressions). All are
  fixed:
  - `termsVersion`: a launch pins the fee and curve terms it was shown; any change reverts it.
  - OG images reject decompression bombs by reading the real pixel size (`src/lib/image-bytes.ts`).
  - Per-client X lookup budgets for previews and launches.
  - `getTokens` pages kept out of Multicall3 batching (the `pagedClient` in hooks).
  - Trade slippage is measured from the quote the user saw.
  - IPv4-mapped IPs keyed correctly (`src/lib/ip.ts`).
  - Address pinning is all or nothing.
  - Renamed X accounts are checked by id before any avatar or @-mention (`useHandleChecks`).
  - Loading and error states instead of zeros on /me and in fee streams.
  - Stable token and trade queries.
- A third pass found 13 smaller issues in those fixes. All are fixed:
  - token/trade refresh loops
  - trade list recovery after a failed first load
  - resolver budgets: checked before they are charged, misses weighted, /48 grouping, a separate
    proof-check budget, fxtwitter 429 retry
  - the JPEG header walk matches the decoder
  - GIF share cards
  - clearer upload and /setup messages
  - home cards use stickers
  - a "missing" status, distinct from "renamed"
- A fourth pass found 10 issues in the new budgets. All are fixed:
  - No shared counter can stop launches or claims any more: limits are per client (IP; IPv6 per
    /64) plus per IPv6 /48 (`limitClient` in `src/lib/ratelimit.ts`, used by every API route).
  - Previews keep a global cap, but past it each client still gets a fair share; `/api/x/resolve`
    returns `incomplete` handles and `useXProfiles` retries them.
  - In x-api mode, X API calls are capped at `X_API_CALLS_PER_MIN`; past that, launches use fxtwitter.
  - Proof posts are cached per status id (404s too) and fetches are budgeted per client.
  - Shared windows live in their own map, so a flood of client keys can't reset them.
  - Share cards only get JPEGs satori can size, and fall back to the initials card if rendering fails.
  - Malformed pinned addresses fail the build.
  - `npm test` loads server modules through `src/lib/test-hooks.mjs` (server-only stub, .ts resolution).
- If you change anything substantial, run a review → fix → verify loop again. Unit tests live in
  `src/lib/*.test.ts` and run with `npm test`.
