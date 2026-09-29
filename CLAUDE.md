# SplitEarn (repo: ponsplit): working notes for Claude

The owner (GitHub: furkan3152) writes in Turkish, so answer in Turkish. They often work from a
phone and can't edit environments by hand. Keep instructions to taps and copy/paste.

## What this is

SplitEarn is a launchpad on **pons** (ponsfamily.com, Robinhood Chain) where a coin's creator fees are
split between up to 10 X (Twitter) accounts. The site is not affiliated with pons, and says so.

- **Mainnet only on the public site (owner's call, 2026-09-29).** `TESTNET_ENABLED` in `networks.ts` is off unless
  `NEXT_PUBLIC_ENABLE_TESTNET=1` or `NEXT_PUBLIC_DEFAULT_NETWORK=testnet` (the testnet fork e2e sets the latter): no switch,
  no testnet chain in wallets, `?network=testnet` stays on mainnet. The two-network code below remains for the tests.
- **Two networks (code).** A Main / Test switch at the top of every page picks the network (cookie
  `pe-network`, `?network=` links set it via `src/middleware.ts`; `src/lib/networks.ts`,
  `network-context.tsx`). Mainnet chainId 4663, testnet 46630. RPCs:
  `https://rpc.mainnet.chain.robinhood.com`, `https://rpc.testnet.chain.robinhood.com`.
  - Mainnet: the real pons v2 (factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`).
  - Testnet: pons isn't there, so SplitEarn deploys its own copy of pons's verified v2 contracts
    (contracts/vendor) with pons's mainnet terms, on the testnet's real Uniswap v4.
- **Coins are pons coins.** `SplitEarnLauncher.launch` calls pons's factory with a per-coin
  `FeeSplitter` clone as the creator fee recipient. pons mints (1B supply), runs the bonding curve
  (phantom 1.68 ETH, graduation at 4.2 ETH, 3 s snipe tax) and graduates two-phase into a locked
  Uniswap v4 pool (`createGraduatedPool`, permissionless; the coin page has a button for it).
  Trading: curve buy/sell directly on pons's curve, pool trades through `SplitEarnRouter`.
- **Fees.** pons's 1% fee: 30% pons, 70% creator. Of the creator part 20% goes to SplitEarn
  (`platformShareBps`, max 30%, set by the owner on /setup for new coins; still 20% on 2026-09-29, the owner was weighing 10-30%) and
  the rest to the X accounts; the optional creator tax (0-10%, chosen
  at launch, default 0) goes 100% to the accounts. Each coin snapshots `platformBps`. A SplitEarn launch fee (~$1) was built
  into the contracts and then dropped by the owner (2026-09-29): the live v1 contracts stay, no redeploy.
  Instead (owner, 2026-09-29, "kontratsız"): a **~$2 launch fee without contracts** (`launchFee` in `src/deployment.json`,
  0.00073 ETH to the owner's wallet; env `NEXT_PUBLIC_LAUNCH_FEE_ETH`/`_TO` override it, as the e2e does). /create sends it as a
  plain ETH transfer first; `/api/attest` (`src/lib/launch-fee.ts`) signs only for a successful payment from the creator
  with no `Launched` by that creator since (one payment per launch; ≤ 900k blocks old). Limit: an attestation lives 30 min,
  so someone calling the contract directly could launch more than once on one payment within that window. FeeVault keys
  balances by the permanent numeric X user id. Claims use `collectAndClaim` to collect first.
- **Signing.** One server key (both networks) signs EIP-712 messages, domain
  `SplitEarn FeeVault` v1 with chainId + vault:
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

Layout: `contracts/` holds Hardhat: `SplitEarnLauncher`, `FeeSplitter`, `FeeVault`, `SplitEarnRouter`,
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
cd contracts && npx hardhat test          # 30 tests on the real pons/Uniswap stack (solc-js 0.8.24 via a compile subtask, viaIR)
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
- The owner's wallet `0xff3a…` is EIP-7702 delegated: it receives ETH on the real chain, but Hardhat
  forks can't run its code, so transfers to it fail on forks (a fork artifact, not a bug).
- CI's e2e blanks `src/deployment.json` first ("Unpin the live deployment"), since the repo pins the live
  contracts and the forks need fresh ones.
- **Load and RPC.** Shared chain reads (coin list, 24h activity, payouts, a coin's trades) come from
  `/api/snapshot` and `/api/trades` (`src/lib/server-snapshot.ts`, logic in `chain-reads.ts`), cached
  by the CDN for ~10 s (server memo 5 s; raised from 4 s to halve RPC and Vercel usage), so a crowd costs the RPC one read. Browsers fall back to reading the chain
  themselves if the server can't answer. RPCs: `NEXT_PUBLIC_<NET>_RPC_URL` (comma list, public, e.g. a
  domain-restricted paid key) and server-only `<NET>_RPC_URL`, each with the public RPC as a viem
  `fallback` (`src/lib/rpc.ts`; a localhost URL is used alone). `stress.yml` load-tests the live site.
- Vercel functions don't ship `public/`: server-rendered images take the logo from `src/lib/logo-svg.ts`
  (written by `scripts/render-logo.mjs`).
- Cloud containers can often only reach GitHub (and npm). To reach the chain, fxtwitter or any web
  page, run the `chain.yml` (script against a network or a fork), `fetch.yml` (URLs) or `probe.yml`
  workflows and read their logs.
- CI (`ci.yml`) jobs: contracts (+ vendor reproducibility + ABI/bytecode drift), security (Slither),
  pons-fork (mainnet: real pons incl. byte-for-byte check; testnet: pons copy), web, e2e (both forks).

## Deployment state (last updated 2026-09-28)

- **Testnet is live** (2026-09-28): the owner deployed from `/setup` with `0xff3a3cfc42d27e85dba9ea85f0bfec34bd632f9a`
  (19 txs). Launcher `0x5D95C13c6Ef4874AcDfcd3A68cE62e17E65cFe59`, FeeVault `0x5ad954cd8F5c681a2C3FC2a399868a37e3611aB7`,
  pons copy factory `0xF2531ee1d731653d3C4F3CE24B98dB5bDFa78c88`, router `0x4d35Bf6f7592c9EFDF179E2f079Aabd99c379333`,
  pinned in `src/deployment.json`; `inspect.yml` (with the site's launch simulation) passes. Site signer
  `0xc4d9873e95b8215eBC189c939DBFe06961E71193`.
- **Mainnet is live** (2026-09-28): deployed by the owner from `/setup` (3 txs). Launcher
  `0x71e139e09eF72A7F580f6704AAa4508D2b195ffb` on the real pons factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`,
  FeeVault `0x5ad954cd8F5c681a2C3FC2a399868a37e3611aB7` (same CREATE2 address as testnet: same owner, signer
  and salt), router `0xFDAB96824E8D5bA381a38346A4e3450d1c71CB1D`; `inspect.yml` passes. None of pons's
  contracts exist on testnet (checked 2026-09-28), so testnet keeps SplitEarn's copy.
- **Render.** Service `ponsplit-testnet` (id `srv-dasv10bbc2fs73agp3sg`, workspace
  `tea-d7ccecdckfvc73887jo0`) auto-deploys the branch and now serves the two-network site. Its
  `SIGNER_PRIVATE_KEY` was shared in chat once, so it's public and testnet-only; its old
  `NEXT_PUBLIC_FEE_VAULT_ADDRESS` / `NEXT_PUBLIC_LAUNCHPAD_ADDRESS` pins belong to the old
  SplitLaunchpad contracts and are ignored now. The owner's plan is one Vercel site for both
  networks with a fresh key; Render can then be retired.
- **Old testnet contracts** (SplitLaunchpad era, 2026-09-28): FeeVault `0x79729a008b26Fd1c3d50a9dF4ceD538B096380E5`,
  SplitLaunchpad `0xB6404ab2d13808eFA3885ff05900aa9d59964cf3`, owner `0x36b1f70cFcA2DB13aA43B0208f6979c5407099b9`.
  Unused by the site; coins launched there stay there.
- **Vercel** (the owner's choice for production): project `ponsplit` (team scope `akdogan1`), auto-deploys
  the branch to production. Domain **splitearn.app** (bought on Vercel by the owner; `www.` redirects
  to it); `ponsplit.vercel.app` still works. Env: `SIGNER_PRIVATE_KEY` (owner set it), `ADMIN_ADDRESSES` =
  `0xff3a3cfc42d27e85dba9ea85f0bfec34bd632f9a` (the owner's wallet), `BLOB_READ_WRITE_TOKEN` (Blob store
  `splitearn-coin-images`, connected by Claude). 2026-09-29: the owner added a paid RPC: `NEXT_PUBLIC_MAINNET_RPC_URL`
  (domain-restricted, browsers) and `MAINNET_RPC_URL` (sensitive, server). The Vercel MCP connection
  lost access to the `akdogan1` scope (403), so a push is how Claude redeploys. `vercel.json` skips
  builds for commits that don't touch the site (logic in `scripts/vercel-ignore.sh`: Vercel caps `ignoreCommand`
  at 256 characters, and a longer one fails every deploy instantly, as 885959f–f2f6c85 did); put `[deploy]` in a commit message to force one (e.g. after
  an env change, since `NEXT_PUBLIC_*` values are baked in at build time). Hobby forbids commercial use, so Pro before launch.
  MAINNET.md has the owner-facing steps.
- **Several launchers.** The site can read coins from more than one launcher (`Network.launchers` = `launcher` plus
  `previousLaunchers` in `src/deployment.json`; `Coin.launcher`; claims and /setup collect each coin through its own launcher),
  for a future upgrade. Today mainnet has one launcher. The site shows no contract addresses (owner's request).
- **Docs.** `/docs` (sidebar, footer, sitemap): overview, getting started, launching, trading, fees (a live table from
  `useLaunchTerms`), getting paid, safety. No contract addresses, mainnet only.
- **Official token** (2026-09-29): $SEARN `0x3DedFf3Ad2254AC78744176B7BBF16cd94699f04` in `mainnet.officialToken`. Launched on pons directly (deployer `0xAD3845160514165B6fd9347f95df9Ac75F739612`), not through the SplitEarn launcher, so the home card reads its symbol/logo from the token and links "Trade it on pons".
- **$SPLIT** (`0x8A5B967B7632E6b168F02Fc45b7960249ef0256e`, 2026-09-29) is a user's coin, NOT the official token (owner said so).
- **Brand.** X account @SplitEarn (`src/lib/brand.ts`: FollowX button in the home card, sidebar, footer). The home page's
  "Official token" card shows the official CA from `mainnet.officialToken` in `src/deployment.json` (empty = "Coming soon");
  set it when the owner launches the official coin, and its coin page gets an "Official SplitEarn token" badge.
- **/setup is owner-only** and linked from nowhere on the site (owner's request, 2026-09-29; open splitearn.app/setup directly): `src/lib/admin.ts` + `/api/admin/session`. Admins are `ADMIN_ADDRESSES` plus
  the on-chain owner of each pinned launcher; they sign a one-time message and get a signed, http-only
  session cookie. Everyone else sees only the sign-in screen (e2e checks this).

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
  way, trading inside SplitEarn, 20% of the creator share to SplitEarn / 80% to the X accounts, a
  creator tax (0-10%, default 0) all to the accounts, the name SplitEarn with a not-affiliated note,
  and then both networks selectable at the top with no mock data and deploys from their own wallet.
  Built: the contracts above (29 unit tests on the real stack; fork tests on both real networks,
  including a byte-for-byte check of the vendored pons code against mainnet), the two-network site,
  wallet `/setup` for both networks, and a fork e2e for both. SplitLaunchpad/SplitToken are gone.
- **2026-09-28, later.** CI is fully green on both forks (a7d307c): /setup deploys (testnet 19
  steps, mainnet 3), launch, curve and pool trades, graduation, fee collection and claims. Fixed on
  the way: `collectMany`/`FeeSplitter.collect` revert on a starved collection instead of skipping
  it (gas estimation had settled on a limit that skipped it), and /setup plan step keys are unique
  (the executor deploy and its wiring shared a key and stalled testnet setup). The owner asked
  Claude to deploy testnet from the old admin wallet `0x36b1f7…`; a key-signing deploy workflow was
  refused by the permission system, so testnet too is deployed by the owner on /setup.
- **SplitEarn rename + redesign (2026-09-28).** The project is now SplitEarn (contracts `SplitEarnLauncher`,
  `SplitEarnRouter`, EIP-712 `SplitEarn FeeVault`, salts `splitearn:v1`). The logo is the owner's S drawn as a sticker
  (two halves, lime and green, split by a diagonal; `art/Logo.tsx`; `scripts/render-logo.mjs` renders the static
  icons). The owner tried a glassmorphism redesign and asked to keep the current interface. The hero's split machine keeps the round, diagonally split coin (the owner's choice; the S is only the
  logo). `art/Doodles.tsx` adds sticker doodles (hero sides, heading stickers, card confetti). The owner's test coins
  ($MAINNET on mainnet, $TEST on testnet) are hidden via `hidden` in `src/deployment.json`. The shell follows the owner's
  reference: sidebar (`Sidebar.tsx`, folds; `data-sidebar` on `<html>`), top bar with coin search
  (`SearchBox.tsx`), 5-tab bar on phones; home is a centred hero plus bento panels of real chain data
  (`components/home/Bento.tsx`, `usePayouts`, `useTopEarners`); the board moved to `/explore`. The split
  animation always shows a fixed example set of well-known accounts with real photos, labelled as an example
  (the owner asked that no coin be featured there). Coin images upload from files (`/api/upload`: Vercel Blob, else Pinata;
  `shrink-image.ts` shrinks photos in the browser).
