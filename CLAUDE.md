# PonsEarn (repo: ponsplit): working notes for Claude

The owner (GitHub: furkan3152) writes in Turkish, so answer in Turkish. They often work from a
phone and can't edit environments by hand. Keep instructions to taps and copy/paste.

## What this is

PonsEarn is a launchpad on **pons** (ponsfamily.com, Robinhood Chain) where a coin's creator fees are
split between up to 10 X (Twitter) accounts. The site is not affiliated with pons, and says so.

- **Two networks at once.** A Main / Test switch at the top of every page picks the network (cookie
  `pe-network`, `?network=` links set it via `src/middleware.ts`; `src/lib/networks.ts`,
  `network-context.tsx`). Mainnet chainId 4663, testnet 46630. RPCs:
  `https://rpc.mainnet.chain.robinhood.com`, `https://rpc.testnet.chain.robinhood.com`.
  - Mainnet: the real pons v2 (factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`).
  - Testnet: pons isn't there, so PonsEarn deploys its own copy of pons's verified v2 contracts
    (contracts/vendor) with pons's mainnet terms, on the testnet's real Uniswap v4.
- **Coins are pons coins.** `PonsEarnLauncher.launch` calls pons's factory with a per-coin
  `FeeSplitter` clone as the creator fee recipient. pons mints (1B supply), runs the bonding curve
  (phantom 1.68 ETH, graduation at 4.2 ETH, 3 s snipe tax) and graduates two-phase into a locked
  Uniswap v4 pool (`createGraduatedPool`, permissionless; the coin page has a button for it).
  Trading: curve buy/sell directly on pons's curve, pool trades through `PonsEarnRouter`.
- **Fees.** pons's 1% fee: 30% pons, 70% creator. Of the creator part 20% goes to PonsEarn
  (`platformShareBps`, max 30%) and 80% to the X accounts; the optional creator tax (0-10%, chosen
  at launch, default 0) goes 100% to the accounts. Each coin snapshots `platformBps`. FeeVault keys
  balances by the permanent numeric X user id. Claims use `collectAndClaim` to collect first.
- **Signing.** One server key (both networks) signs EIP-712 messages, domain
  `PonsEarn FeeVault` v1 with chainId + vault:
  - `SplitAttestation` for launches: username → id, bound to the creator.
  - `Claim` for payouts, bound to the destination wallet.
- **Proving account ownership.** Either X OAuth (next-auth, optional), or a proof post. A proof
  post must be a standalone post whose whole text is exactly `proofText(handle, wallet)`: the full
  wallet plus an HMAC code. Replies, quotes and substring matches are rejected. The post is read
  via api.fxtwitter.com.
- **No mock data, ever** (the owner's rule): no mock X resolver, no dev login, no mock contracts in
  tests. Tests run on the real pons / Uniswap v4 / Permit2 code; e2e runs on forks of the real
  networks with real X accounts (@jack = 12, @x = 783214).
- **X Money is intentionally NOT used.** The owner decided this. It has no API, is US-only and needs KYC.

Layout: `contracts/` holds Hardhat: `PonsEarnLauncher`, `FeeSplitter`, `FeeVault`, `PonsEarnRouter`,
`interfaces/`, `vendor/` (pons v2 + Uniswap v4 + Permit2 verified sources, `vendor/build.js` compiles
them byte for byte into `vendor/out`), `scripts/lib/pons-stack.js` (deploys the real stack for tests).
The Next.js 14 app is at the repo root: `src/app`, `src/lib` (data layer: `hooks.ts`, `pons.ts`
quotes, `deploy-plan.ts` for /setup), `src/components`. The Playwright suite is in `e2e/`. Docs are
Turkish: README.md and MAINNET.md.

## Design system ("split terminal")

The owner asked for a UI that doesn't look generated. Keep new work in this language:
- **Theme.** Near-black paper with film grain and ambient light, Robin-neon lime `#ccff00`, and
  pastel account colors (sky, pink, sun, lilac, orange) for the X accounts. Dark by default; the
  light "paper edition" is chosen with `<ThemeToggle>`. The choice lives in `<html data-theme>`,
  set before first paint by `THEME_SCRIPT` in `src/lib/theme.ts`. Tailwind `dark:` uses that
  attribute, not the OS setting.
- **Tokens.** CSS variables in `src/app/globals.css` (colors, `.card`, `.card-hover`, `.ring-glow`,
  `.bg-grid`, `.eyebrow`, `.display`, `.accent`, `.text-neon`, `.btn-neon`, …) plus `tailwind.config.ts`
  (colors, fonts, animations).
- **Fonts.** Bricolage Grotesque (`display`), Instrument Sans (body), Instrument Serif (`accent`, at
  most one word per page) and Martian Mono (`num`, all numbers and addresses).
- **Motion.** `src/components/motion.tsx`: `<Reveal>`, `<CountUp>`, `<Flash>`, `celebrate()`.
  Everything stops under reduced motion; SVG/JS motion checks `useReducedMotion()`.
- **Hero art.** The hero is `src/components/art/SplitMachine.tsx`. The sticker art in
  `src/components/art` stays for avatars and states.
- **Width.** Decorations must never widen the page. The e2e measures overflow against the
  configured viewport width.
- **Screenshots.** `e2e/screens.mjs` takes review screenshots of every page (dark/light,
  desktop/mobile).

## Hard rules

- **Never generate, read, print or store private keys or seeds.** Not in chat, git, files or tool
  calls. The owner generates the signing key on `/setup` in their browser and pastes it into the host
  themselves. The owner deploys every contract from their own wallet on `/setup`; never ask for, or
  accept, their wallet key. (CI makes a throwaway `SIGNER_SEED` inside the job; that's fine.)
- **No mock data** (see above).
- Develop on branch `claude/split-robinhood-version-d6nsuj`, which is also the default branch.
  Push only there. Don't open PRs unless asked.
- Commits end with the Co-Authored-By / Claude-Session trailers used in `git log`.

## Commands

```bash
cd contracts && npx hardhat test          # 27 tests on the real pons/Uniswap stack (solc-js 0.8.24 via a compile subtask, viaIR)
cd contracts && node vendor/build.js      # re-derive vendor/out from the verified sources (CI checks they match)
cd contracts && node scripts/export-abi.js  # regenerate src/lib/abi.ts + bytecode.ts after any .sol change (CI checks)
cd contracts && FORK_URL=<rpc> FORK_NETWORK=mainnet|testnet npx hardhat test test/fork/PonsMainnet.fork.test.js
npx tsc --noEmit && npx next lint && npm test   # web typecheck, lint, unit tests (src/lib/*.test.ts)
# e2e (CI job `e2e`, matrix testnet/mainnet): hardhat node --fork <rpc> with HARDHAT_CHAIN_ID, then
#   cd e2e && node prepare-fork.mjs; build with NEXT_PUBLIC_<NET>_RPC_URL=http://127.0.0.1:8545 and a
#   SIGNER_SEED; node setup.mjs (deploys via /setup, writes deploy.env); rebuild with deploy.env; node full.mjs
```

Gotchas:
- Hardhat's well-known accounts carry EIP-7702 delegations on both real networks and refuse ETH;
  on forks clear their code first (`e2e/prepare-fork.mjs`, the fork test's before hook).
- EDR can't run calls against a Robinhood fork block itself (no blob-gas header fields): mine one
  local block first.
- On forks ArbSys (0x64) is Arbitrum's `0xfe` placeholder; the launcher's `arbBlockNumber` call has
  a 20k gas stipend and falls back to `block.number`.
- Robinhood's public RPC: logs ≤ 10k per query, block range ≤ 1M with an address filter, ≤ 1000
  selectors; `block.number` in contracts is the parent chain's (L2 number comes from ArbSys).
- `pkill -f "[h]ardhat node"` kills your own shell if the same command line mentions that text
  again. Run pkill as its own command.
- Cloud containers can often only reach GitHub (and npm). To reach the chain, fxtwitter or any web
  page, run the `chain.yml` (script against a network or a fork), `fetch.yml` (URLs) or `probe.yml`
  workflows and read their logs.
- CI (`ci.yml`) jobs: contracts (+ vendor reproducibility + ABI/bytecode drift), security (Slither),
  pons-fork (mainnet: real pons incl. byte-for-byte check; testnet: pons copy), web, e2e (both forks).

## Deployment state (last updated 2026-09-28)

- **Neither network is live on the new (pons) contracts yet.** `src/deployment.json` has empty pins
  for both. Each goes live when the owner deploys from `/setup` (testnet: 19 wallet txs, mainnet: 3)
  and the addresses shown there are committed to `src/deployment.json` (or set as
  `NEXT_PUBLIC_<NET>_LAUNCHER_ADDRESS` / `_FEE_VAULT_ADDRESS` / `NEXT_PUBLIC_TESTNET_PONS_FACTORY`).
  Check a deployment with the `inspect.yml` workflow (read-only; `site` simulates a launch).
- **Render.** Service `ponsplit-testnet` (id `srv-dasv10bbc2fs73agp3sg`, workspace
  `tea-d7ccecdckfvc73887jo0`) auto-deploys the branch and now serves the two-network site. Its
  `SIGNER_PRIVATE_KEY` was shared in chat once, so it's public and testnet-only; its old
  `NEXT_PUBLIC_FEE_VAULT_ADDRESS` / `NEXT_PUBLIC_LAUNCHPAD_ADDRESS` pins belong to the old
  SplitLaunchpad contracts and are ignored now. The owner's plan is one Vercel site for both
  networks with a fresh key; Render can then be retired.
- **Old testnet contracts** (SplitLaunchpad era, 2026-09-28): FeeVault `0x79729a008b26Fd1c3d50a9dF4ceD538B096380E5`,
  SplitLaunchpad `0xB6404ab2d13808eFA3885ff05900aa9d59964cf3`, owner `0x36b1f70cFcA2DB13aA43B0208f6979c5407099b9`.
  Unused by the site; coins launched there stay there.
- **Vercel** (the owner's choice for production): Hobby forbids commercial use, so Pro before launch.
  MAINNET.md has the owner-facing steps.

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
- Round 5 came back clean (0 confirmed). After it: the `inspect.yml` / `smoke-live.mjs` tools, a
  mirror-404 fix (a 404 is confirmed via fxtwitter's `/2/profile/`, launches re-check cached
  misses), and wallet-mode setup for mainnet on Vercel.
- Round 6 found 7 (fixed in f4920b6). Then the "split terminal" redesign (f4920b6, 3a4cbe1).
- Round 7 reviewed the redesign and round-6 fixes through five lenses (coin page, forms, design
  foundation, infra/mainnet flow, screenshots). All confirmed findings are fixed (6fab242, 9244eaf,
  75c6c9d), notably:
  - /setup wallet deploy: a double tap could deploy twice (synchronous guard, stale-read check,
    prefer the vault's wired launchpad); the e2e double-clicks Deploy and expects 3 txs.
  - Owner controls on /setup (the emergency plan needed owner calls no page offered).
  - A negative first buy crashed the launch page; AA contrast for `--ink-3` and the Sell label.
  - Reveals: THEME_SCRIPT drops the `js` class if the app hasn't hydrated after 2.5 s.
  - The hero pauses its motion off screen; the e2e's third pass is the light theme on a phone.
- If you change anything substantial, run a review → fix → verify loop again. Unit tests live in
  `src/lib/*.test.ts` and run with `npm test`.
- **Pons integration (2026-09-28).** The owner asked for coins to be minted and graduated the pons
  way, trading inside PonsEarn, 20% of the creator share to PonsEarn / 80% to the X accounts, a
  creator tax (0-10%, default 0) all to the accounts, the name PonsEarn with a not-affiliated note,
  and then both networks selectable at the top with no mock data and deploys from their own wallet.
  Built: the contracts above (27 unit tests on the real stack; fork tests on both real networks,
  including a byte-for-byte check of the vendored pons code against mainnet), the two-network site,
  wallet `/setup` for both networks, and a fork e2e for both. SplitLaunchpad/SplitToken are gone.
