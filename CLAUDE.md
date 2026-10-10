# Tiksplit (repo: ponsplit): current working notes

The owner's 2026-10-10 request changes this app to a TikTok creator launchpad inspired by
UseReels' fee-allocation logic, with an original interface on Solana mainnet / pump.fun.
Current implementation and setup are in README.md. One TikTok handle per launch; platform
fee 20% + creator escrow 80%, immutable on chain; no launcher reward on new launches. pump.fun's TikTok
platform enum is inactive, so a separate `programs/tiktok-escrow` program is required.
As of 2026-10-10 the owner chose public RPC: browser wallet traffic uses PublicNode mainnet; server/indexed reads use the official public Solana RPC.
Legacy paid SOLANA_RPC_URL / NEXT_PUBLIC_SOLANA_RPC_URL settings are ignored; only
NEXT_PUBLIC_SOLANA_LOCAL_RPC_URL permits an exact loopback validator for tests.
Primary site: https://www.tiksplit.com (apex redirects to www).
Default verification is a public TikTok video with the platform's full handle+beneficiary+nonce
code, signed on-chain creator request, manual admin review pinned to the exact proof hash,
then creator-only activation. Pending approval cannot claim. TikTok Login Kit and an external
managed verifier remain optional for a later approved integration, not today's prerequisite.
No owner private keys belong in the web app. The owner explicitly authorized publishing this
new web version on 2026-10-10; `.deploy-hold` is removed for that release. Money and verification
features must still fail closed without real configuration. `/admin` is the existing
D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm wallet only, via a locally verified ephemeral
signed wallet challenge and native wallet-signed transactions. Optional server hosting mutations
require signed server sessions with durable Redis replay prevention in production. Program deployment
uses hash-pinned public SBF, browser-memory temporary keys, and admin upgrade authority.
Batch-capable wallets (including OKX) default to small groups of eight writes, advanced automatically,
then a separate final deployment approval. Full-batch signing (up to 80 writes) is opt-in; single
signing remains available for compatibility. Uploads carry explicit 25,000 CU / 1,000 micro-lamport
fee settings (25 lamports priority fee), shared by fee quoting and sending. Simulate a real pending
write before each approval group. Uploads never allocate accounts, refund rent or transfer SOL.
Show already-funded buffer rent separately from the remaining wallet requirement.
Validate the entire signed batch before sending anything, send at most
three writes concurrently, and drain in-flight writes before returning any upload failure.
Recover existing buffers by verified public address, including /admin?buffer=... links.
Save each transaction ID before submission and reconcile confirmation transport failures on chain.
Deployment signature checks permit only bounded compute-budget fee changes (max 5,000 lamports/tx),
with their reserve included in quotes, plus wallet-refreshed blockhashes. Instruction/account/authority
changes are rejected. Verify the admin signature over the returned wire message before refreshing
in-memory temporary buffer/program co-signatures. A refreshed hash must not reuse the original hash's
expiry or wallet-supplied lastValidBlockHeight: confirm its exact signature with a bounded timeout,
and reconcile uncertain responses on chain. RPC preflight validates the actual signed hash.
The owner explicitly retains upgrade authority (no renounce). Admin rent recovery covers upload
buffers and cancellation of an unused, never-configured deployment. ProgramData closure permanently
disables the program; its small Program account rent remains locked. The panel blocks configured
programs and any owned accounts, rechecks after wallet signing, and requires typed public program-ID
confirmation. These RPC checks are not an atomic shutdown lock; never close a used creator program.
The owner has no TikTok developer app yet and explicitly chose video proof to finish today.
Use `.github/workflows/splidev.yml`'s current TikTok checks.
Keep the existing default branch; push only there, and do not open PRs unless requested.
Do not invent a Claude identity/session trailer when another agent makes the commit.

The remaining notes below describe the previous GitHub version, for migration context.
Its developer branding, GitHub recipients, claim flow and old E2E scenarios are superseded.

# Previous Splitdev working notes

The brand is **Splitdev** (domain splitdev.app; renamed from "Splidev" on 2026-10-07 at the owner's request).
Internal identifiers keep the old spelling on purpose, so settings and saved state survive: `src/splidev.json`,
`NEXT_PUBLIC_SPLIDEV_*` / `SPLIDEV_METADATA_STORE` env vars, localStorage keys `splidev:*`, `splidev.yml`, `e2e/splidev.mjs`.

The owner (GitHub: furkan3152) writes in Turkish, so answer in Turkish. They often work from a
phone and can't edit environments by hand. Keep instructions to taps and copy/paste.

## What this is

Splitdev is a launchpad on **pump.fun (Solana)** where a coin's creator fees are split, for good,
between up to 9 **GitHub accounts** (plus Splitdev). The site is not affiliated with pump.fun or
GitHub, and says so. It replaced SplitEarn (Robinhood Chain, X accounts) on 2026-10-05 at the
owner's request; the old code is in git history (last SplitEarn commit: `d37e1fa`).

- **No Splitdev program.** A Splitdev coin is a normal pump.fun coin. The launch (src/lib/solana/pump.ts),
  built with pump.fun's SDK (`@pump-fun/pump-sdk` v2, `@pump-fun/pump-swap-sdk`):
  1. `create_v2` with the creator's wallet as creator, plus the first buy in the same transaction;
  2. `create_social_fee_pda` for each GitHub id that has no pump.fun GitHub fee account yet
     (platform 2 = GitHub; the account is keyed by the numeric GitHub user id);
  3. `create_fee_sharing_config` + `update_fee_shares_v2` with shareholders
     **[Splitdev treasury (platformBps), GitHub fee accounts...]** (admin revoked: permanent), and the launch fee
     (a SOL transfer to the treasury).
  All signed in one wallet prompt (`signAllTransactions`), sent in order. If (1) lands and the rest
  doesn't, /create remembers it and offers "Finish $X's launch" (`finishLaunchTransactions`).
- **Discovery.** The treasury is the first shareholder, so one `getProgramAccounts` on pump.fun's fee
  program (SharingConfig discriminator + treasury at offset 80) lists every Splitdev coin (src/lib/solana/reads.ts).
  Anyone can set fee sharing, so a coin is listed only with Splitdev's exact shape: final and Active, treasury
  first at an allowed share (`platformBps`, plus `pastPlatformBps` in splidev.json: add the old value there
  when changing it), every other shareholder a pump.fun GitHub fee account, a SOL curve, not mayhem/cashback.
  `launch-local.mjs` checks a spoofed coin (treasury 1 bps + hidden wallet) stays unlisted.
- **Trades** come only from events emitted by the pump or pump AMM program (inner instruction program checked)
  and, for the pool, this coin's canonical pool; SOL amounts include fees.
- **Unfinished launches** are saved per wallet+mint in localStorage (`splidev:pending-launch:v2`) as soon as the
  wallet signs, and /create checks each against the chain (`launchState`) before offering "Finish";
  `finishLaunchTransactions` returns nothing for a final split and only updates a half-set one.
- **Trades in the panel** are checked against the quote on screen (abort if worse than slippage) and show
  "You pay at most" (pump.fun buys are token-exact with a SOL cap).
- **Claims happen on pump.fun.** Developers sign in with GitHub on pump.fun and claim from their GitHub fee
  account (pump.fun's `social_claim_authority` signs). Splitdev never holds money. /claim shows what a username has
  waiting (fee account balance - rent) and can distribute pending fees. Owner's choice (2026-10-05): pump.fun's
  built-in GitHub fee sharing instead of an own program.
- **Distribution.** pump.fun keeps creator fees in the coin's creator vault until someone calls the
  permissionless distribute (`buildDistributeCreatorFeesInstructions`; graduated coins sweep the pool side too).
  The coin page and /claim have buttons for it.
- **Fees (pump.fun, mainnet, 2026-10-05).** Curve: 1.25% (0.95% pump.fun, 0.30% creator). Pool after graduation:
  creator part by market cap, 0.95% down to 0.05%. Of the creator part, `platformBps` (src/splidev.json,
  1000 = 10% today) goes to Splitdev, the rest to the GitHub accounts by their shares. Splitdev launch fee:
  `launchFeeSol` (0.01 SOL).
- **Settings:** `src/splidev.json` (`treasury`, `platformBps`, `launchFeeSol`, `hidden`, `officialToken`), checked by
  next.config.mjs. `treasury` = `D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm` (the owner's Solana wallet, 2026-10-05).
  `NEXT_PUBLIC_SPLIDEV_TREASURY` / `_PLATFORM_BPS` / `_LAUNCH_FEE_SOL` override them (tests).
- **No mock data, ever** (the owner's rule). Tests run pump.fun's real programs on a local
  `solana-test-validator`: `e2e/solana/fixtures` holds pump, pump AMM, pump fees and mayhem programs and the
  mainnet accounts they need, dumped by `.github/workflows/solana-fixtures.yml` (re-run it when pump.fun upgrades).
  Real GitHub accounts: torvalds = 1024025, gaearon = 810438.

Layout: Next.js 14 app at the repo root. `src/lib/solana/` (config, pump.ts builders, reads.ts, trades.ts
event parser, server.ts snapshot/caches, server-types.ts), `src/lib/github.ts` (+ github-handles.ts,
github-types.ts), `src/lib/hooks.ts`, `src/app` pages (/, /explore, /create, /token/[address], /claim, /me,
/how, /docs) and API routes (/api/snapshot, /api/coin, /api/trades, /api/github/resolve, /api/metadata,
/api/upload). Docs for the owner are Turkish: README.md.

## Design system ("night shift", 2026-10-05)

The owner asked for a completely new, original look for Splitdev (colors, mascot, everything). Keep new work in it:
- **Theme.** A code editor after midnight: deep violet paper (`#0d0a1a`) with a dot matrix (`body::after`) and
  ambient tangerine/violet/mint light; light "daylight" edition on warm cream (`<ThemeToggle>`, `data-theme` set by
  `THEME_SCRIPT`). House color **tangerine `#ff7a3d`** (token still named `--lime` / `bg-lime` / `text-neon`;
  `--lime-deep` for keycap edges and text on cream), mint up `--green`, coral down `--red`, pastel account colors
  (sky, pink, sun, lilac, and `--orange` = chartreuse; names are historic).
- **Mascot: Bitbug** (`art/Bug.tsx`): a beetle with a tangerine shell split down the middle, lilac head, sun
  antenna tips. `<Bug face open flap />` poses it (faces happy/joy/sleepy/wow/wink; `flap` opens the shell via CSS).
  It is the logo (`LogoMark` = `BugMark`), the hero (`SplitMachine`: it opens its shell and fees run down a git graph
  to the developers), and every state illustration (steps, empty, 404, claim, graduated).
- **Dev details.** Eyebrows read as code comments (`// label`, `.eyebrow::before`), wordmark `splitdev` with a blinking
  caret (`WordmarkText`), buttons are keycaps (solid bottom edge, press travels down), bento panels are editor panes
  (window dots + `name.sol` tab), doodles are `</>`, `{ }`, a little git graph (`parts.tsx`: CodeTag, Braces, Commits).
- **Fonts.** Space Grotesk (`display`), Figtree (body), Fraunces soft wonky italic (`accent`, one word per page, with a
  wavy tangerine underline), JetBrains Mono (`num`, ligatures off). (Sora was tried: its "l" reads as "1".)
- Tokens in `src/app/globals.css` + `tailwind.config.ts`; colors are CSS variables, so Tailwind alpha modifiers
  (`bg-x/50`) don't work on them. Motion in `src/components/motion.tsx`, stops under reduced motion.
- Static logos (`public/logo.svg`, `src/app/icon.svg`, `src/lib/logo-svg.ts`) come from `node scripts/render-logo.mjs`;
  share cards (`opengraph-image.tsx`) use the night palette. Decorations must never widen the page (the browser e2e
  checks every page at 1280 and 390 px).

## Hard rules

- **Never generate, read, print or store private keys or seeds** of the owner or the site. Tests use
  throwaway local keypairs on the local validator only. The owner gives only public addresses.
- **No mock data** (see above).
- Develop on branch `claude/split-robinhood-version-d6nsuj`, which is also the default branch.
  Push only there. Don't open PRs unless asked.
- Commits end with the Co-Authored-By / Claude-Session trailers used in `git log`.

## Commands

```bash
npx tsc --noEmit && npx next lint && npm test        # web typecheck, lint, unit tests (src/lib/**/*.test.ts)
# local pump.fun (needs the Solana CLI, e.g. /opt/solana/solana-release/bin):
e2e/solana/validator.sh /tmp/ledger                   # validator with pump.fun's programs + accounts
node e2e/solana/build-lib.mjs                         # bundle src/lib/solana for the Node scripts
RPC=http://127.0.0.1:8899 node e2e/solana/launch-local.mjs    # launch, list, trades, quotes, distribute, claimable
RPC=http://127.0.0.1:8899 node e2e/solana/graduate-local.mjs  # two-part launch, graduation, pool trades
# browser: build with NEXT_PUBLIC_SOLANA_RPC_URL/SOLANA_RPC_URL=http://127.0.0.1:8899, NEXT_PUBLIC_SPLIDEV_TREASURY=<pubkey>,
#   start with SPLIDEV_METADATA_STORE=memory, then: cd e2e && BASE=… RPC=… TREASURY=… node splidev.mjs
```

Gotchas:
- pump.fun's SDK ESM build doesn't load under plain Node (a CommonJS dependency); Next bundles it fine,
  Node scripts use the esbuild bundle (`e2e/solana/build-lib.mjs`) or `createRequire`.
- The first launch transaction (create_v2 + first buy, ~25 accounts) sits at Solana's 1232-byte limit:
  keep extra instructions out of it (the launch fee rides with the fee-sharing transaction), keep
  metadata links short (`m/<16 hex>` on Blob), and `createTransaction` drops the compute budget
  instructions when a long name wouldn't fit. `launch-local.mjs` launches the longest allowed name.
  An address lookup table would give room back (none exists yet; it needs a one-time owner transaction).
- The public mainnet RPC rate-limits `getTransaction` hard: scans of many transactions in `solana.yml` time out.
- `getProgramAccounts` on pump.fun's fee program: ~730k SharingConfigs on mainnet (2026-10-05); an unfiltered
  count takes ~60 s, but the site's query (discriminator + treasury at offset 80) is fast. Never run it on the
  pump program itself (millions).
- pump.fun pools price with virtual SOL reserves on top of the real ones (`pool.virtualQuoteReserves`):
  quotes must pass them (`poolTerms`).
- A brand-new pump.fun fee account must exist (rent-exempt) before distributions pay into it: the launch
  creates the missing ones.
- The cloud container can't reach Solana RPCs, pump.fun or api.github.com (proxy 403). Use the
  `solana.yml` workflow (mainnet scripts; pump SDKs installed), `solana-fixtures.yml`, and CI; GitHub
  release downloads and npm work, so the Solana CLI installs locally.
- Creating a `.deploy-hold` file holds Vercel deploys (scripts/vercel-ignore.sh skips every build while it exists).

## Deployment state (2026-10-05, Splitdev live)

- **Vercel**: project `ponsplit` (`prj_K4lYPXiOoIIqWqjNvaJxqqiuBeJI`; the MCP works with the project id and no team
  slug, the `akdogan1` slug answers 403), domain **splitdev.app** (bought by the owner 2026-10-07; www redirects to it;
  `SITE_URL=https://splitdev.app`), splitearn.app still serves too, auto-deploys the branch (`.deploy-hold` removed at cutover, owner confirmed). Env (production + preview): `NEXT_PUBLIC_SOLANA_RPC_URL` = QuickNode endpoint 671368
  (divine-boldest-choice, referrer-locked to splitdev.app, www.splitdev.app, splitearn.app, www.splitearn.app,
  ponsplit.vercel.app; per-method rate limits need a paid QuickNode plan), `SOLANA_RPC_URL`
  (sensitive) = QuickNode endpoint 671317 (delicate-wiser-snow, token only), `BLOB_READ_WRITE_TOKEN`. Old EVM env
  (`SIGNER_PRIVATE_KEY`, `ADMIN_ADDRESSES`, `MAINNET_RPC_URL`, `NEXT_PUBLIC_MAINNET_RPC_URL`, `NEXT_PUBLIC_CHAIN`)
  is unused; the MCP has no delete for env vars, so the owner deletes them in the dashboard.
- **QuickNode** (owner's account, MCP connected): 671368 and 671317 are Splitdev's. 671312 (chaotic-quiet-rain) is
  referrer-locked to siglospay.com, another project of the owner's: don't touch it. Also robinhood/arc endpoints.
- **Owner TODO**: `GITHUB_TOKEN` (no scopes) on Vercel: without it GitHub lookups run on the 60/hour anonymous limit
  per server IP (src/lib/github.ts keeps its own hourly budget below that: 30 username + 20 id lookups, ids cached a
  day, stale profiles served when busy). Claude can't mint one.
- **Review round (2026-10-07)**: four parallel reviews (money logic, UI flows, server security, displayed numbers);
  fixed: listing spoofing, fake trade events, unfinished-launch recovery, buy slippage vs the shown quote,
  GitHub quota exhaustion, slow metadata hosts stalling the snapshot (2.5 s cap, failures cached), DNS rebinding
  (undici connect-time check), RPC cost of random /token addresses, pool-side pending fees, coin ages, upload caps. New domain/X for Splitdev if wanted (brand.ts `X_HANDLE` is empty, links hide).
- SplitEarn's Robinhood contracts stay on chain; the site no longer shows them (owner accepted that).
