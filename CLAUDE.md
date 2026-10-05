# Splidev (repo: ponsplit): working notes for Claude

The owner (GitHub: furkan3152) writes in Turkish, so answer in Turkish. They often work from a
phone and can't edit environments by hand. Keep instructions to taps and copy/paste.

## What this is

Splidev is a launchpad on **pump.fun (Solana)** where a coin's creator fees are split, for good,
between up to 9 **GitHub accounts** (plus Splidev). The site is not affiliated with pump.fun or
GitHub, and says so. It replaced SplitEarn (Robinhood Chain, X accounts) on 2026-10-05 at the
owner's request; the old code is in git history (last SplitEarn commit: `d37e1fa`).

- **No Splidev program.** A Splidev coin is a normal pump.fun coin. The launch (src/lib/solana/pump.ts),
  built with pump.fun's SDK (`@pump-fun/pump-sdk` v2, `@pump-fun/pump-swap-sdk`):
  1. `create_v2` with the creator's wallet as creator, plus the first buy in the same transaction;
  2. `create_social_fee_pda` for each GitHub id that has no pump.fun GitHub fee account yet
     (platform 2 = GitHub; the account is keyed by the numeric GitHub user id);
  3. `create_fee_sharing_config` + `update_fee_shares_v2` with shareholders
     **[Splidev treasury (platformBps), GitHub fee accounts...]** (admin revoked: permanent), and the launch fee
     (a SOL transfer to the treasury).
  All signed in one wallet prompt (`signAllTransactions`), sent in order. If (1) lands and the rest
  doesn't, /create remembers it and offers "Finish $X's launch" (`finishLaunchTransactions`).
- **Discovery.** The treasury is the first shareholder, so one `getProgramAccounts` on pump.fun's fee
  program (SharingConfig discriminator + treasury at offset 80) lists every Splidev coin (src/lib/solana/reads.ts).
  Coins whose split isn't final or isn't treasury-first aren't listed.
- **Claims happen on pump.fun.** Developers sign in with GitHub on pump.fun and claim from their GitHub fee
  account (pump.fun's `social_claim_authority` signs). Splidev never holds money. /claim shows what a username has
  waiting (fee account balance - rent) and can distribute pending fees. Owner's choice (2026-10-05): pump.fun's
  built-in GitHub fee sharing instead of an own program.
- **Distribution.** pump.fun keeps creator fees in the coin's creator vault until someone calls the
  permissionless distribute (`buildDistributeCreatorFeesInstructions`; graduated coins sweep the pool side too).
  The coin page and /claim have buttons for it.
- **Fees (pump.fun, mainnet, 2026-10-05).** Curve: 1.25% (0.95% pump.fun, 0.30% creator). Pool after graduation:
  creator part by market cap, 0.95% down to 0.05%. Of the creator part, `platformBps` (src/splidev.json,
  1000 = 10% today) goes to Splidev, the rest to the GitHub accounts by their shares. Splidev launch fee:
  `launchFeeSol` (0.01 SOL).
- **Settings:** `src/splidev.json` (`treasury`, `platformBps`, `launchFeeSol`, `hidden`, `officialToken`), checked by
  next.config.mjs. `treasury` is EMPTY until the owner gives their Solana wallet address: launches are off until then.
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

## Design system ("split terminal")

Unchanged from SplitEarn (the owner liked it): near-black paper, lime `#ccff00`, pastel account colors,
dark by default with the light "paper edition" (`<ThemeToggle>`, `data-theme` set by `THEME_SCRIPT`).
Tokens in `src/app/globals.css` + `tailwind.config.ts`. Fonts: Bricolage Grotesque (display), Instrument
Sans (body), Instrument Serif (`accent`, one word per page), Martian Mono (`num`). Motion in
`src/components/motion.tsx`, stops under reduced motion. Hero art `art/SplitMachine.tsx` with an example
set of well-known GitHub devs (torvalds, gaearon, sindresorhus, yyx990803, tj), labelled as an example.
Logo: the S sticker (`art/Logo.tsx`), wordmark "Spli**dev**". Decorations must never widen the page
(the browser e2e checks every page at 1280 and 390 px).

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
- `getProgramAccounts` on pump.fun's fee program is fine (thousands of accounts); never on the pump
  program itself (millions).
- pump.fun pools price with virtual SOL reserves on top of the real ones (`pool.virtualQuoteReserves`):
  quotes must pass them (`poolTerms`).
- A brand-new pump.fun fee account must exist (rent-exempt) before distributions pay into it: the launch
  creates the missing ones.
- The cloud container can't reach Solana RPCs, pump.fun or api.github.com (proxy 403). Use the
  `solana.yml` workflow (mainnet scripts; pump SDKs installed), `solana-fixtures.yml`, and CI; GitHub
  release downloads and npm work, so the Solana CLI installs locally.
- Vercel deploys are **held** while `.deploy-hold` exists (scripts/vercel-ignore.sh). Remove it at cutover.

## Deployment state (2026-10-05)

- **Vercel**: project `ponsplit` (team `akdogan1`), domain splitearn.app, auto-deploys the branch, but held
  (.deploy-hold) so it still serves the last SplitEarn build until Splidev is ready. Env to add for Splidev:
  `NEXT_PUBLIC_SOLANA_RPC_URL` (browser RPC, e.g. Helius/Alchemy Solana, domain-restricted), `SOLANA_RPC_URL`
  (server RPC), `GITHUB_TOKEN` (any token, no scopes, for 5,000 GitHub lookups an hour), `BLOB_READ_WRITE_TOKEN`
  (already set: images and metadata JSON). Old EVM env (`SIGNER_PRIVATE_KEY`, `ADMIN_ADDRESSES`,
  `MAINNET_RPC_URL`, ...) is unused now.
- **Owner TODO**: Solana wallet address for `treasury`; a Solana RPC key; a GitHub token; new domain/X for
  Splidev if wanted (brand.ts `X_HANDLE` is empty, links hide).
- SplitEarn's Robinhood contracts stay on chain; the site no longer shows them (owner accepted that).
