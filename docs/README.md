# Splitdev — operator notes

Splitdev is a launchpad on **pump.fun** (Solana) that mints a coin and splits the coin's creator fees
between **GitHub accounts**. When launching a coin you pick up to nine GitHub usernames and their shares;
the creator fee from every trade of the coin flows to those developers.

Splitdev is not affiliated with pump.fun; it uses pump.fun's public programs.

These are operator notes for running and deploying the live site. For a project overview, see the
top-level [README](../README.md).

## How it works

1. **Launch.** On `/create` you enter a name, symbol, image, GitHub usernames and shares. The wallet
   signs once:
   - pump.fun `create_v2` (plus an optional first buy), creator = the launching wallet;
   - any missing GitHub fee accounts (pump.fun's own GitHub accounts, keyed by the numeric GitHub user id);
   - the permanent fee split: the Splitdev treasury first (`platformBps`, currently 10%), the rest to the
     GitHub accounts; admin rights are revoked, so the shares can never change again;
   - the launch fee (`launchFeeSol`, currently 0.01 SOL) to the treasury.
2. **Trading.** On the coin page you trade on the bonding curve and, after graduation, in pump.fun's
   pool (PumpSwap).
3. **Fees.** pump.fun's creator fee accumulates in the coin's vault. The **"Distribute now"** button on
   the coin page (anyone can press it) distributes it by shares.
4. **Claiming.** Developers claim their funds by **signing in with GitHub on pump.fun**. Splitdev has no
   separate contract or signing key. The `/claim` page shows how much a GitHub user can claim and which
   coins it comes from.

## Settings

`src/splidev.json`:

| Field | Meaning |
| --- | --- |
| `treasury` | Splitdev's Solana wallet address (minting is disabled while empty) |
| `platformBps` | Splitdev's share, in basis points (1000 = 10%) |
| `launchFeeSol` | Launch fee, in SOL |
| `hidden` | Coin addresses to hide from the site |
| `officialToken` | The official coin address (empty = "Coming soon") |

Vercel environment variables:

- `NEXT_PUBLIC_SOLANA_RPC_URL`: the browser RPC (`https://solana-rpc.publicnode.com`)
- `SOLANA_RPC_URL`: a server RPC that supports account scans (`https://api.mainnet-beta.solana.com`)
- `SITE_URL` and `NEXTAUTH_URL`: `https://splitdev.app`
- `GITHUB_TOKEN`: for GitHub user lookups (an unprivileged, scopeless token is enough)
- `BLOB_READ_WRITE_TOKEN`: Vercel Blob, for coin images and metadata

## Deployment (as of 2026-10-12)

- The production domain is **splitdev.app**; `www.splitdev.app` redirects to it.
- Treasury: `D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm`.
- RPC: the free public endpoints listed above; no paid RPC provider is configured.
- Recommended step: GitHub → Settings → Developer settings → Personal access tokens → "Generate new
  token" (select no permissions), then add the resulting value to the Vercel project's Settings →
  Environment Variables as `GITHUB_TOKEN`. This raises GitHub lookups from 60 to 5,000 per hour.

## Development

```bash
npm ci
npx tsc --noEmit && npx next lint && npm test   # typecheck, lint, unit tests
npm run build
```

The tests run against pump.fun's **real** programs on a local `solana-test-validator` (the programs and
accounts live in `e2e/solana/fixtures`, pulled from mainnet by `solana-fixtures.yml`):

```bash
e2e/solana/validator.sh /tmp/ledger     # local validator with pump.fun's programs
node e2e/solana/build-lib.mjs
node e2e/solana/launch-local.mjs         # launch, trade, distribute
node e2e/solana/graduate-local.mjs       # graduation, pool trading
node e2e/solana/github-fee-compat-local.mjs # current creator-fee vaults, nine recipients, resume
```

CI (`splidev.yml`): `pump-local` (the tests above), `web` (typecheck, lint, unit, build) and `browser`
(a real launch, trade, distribute and `/claim` through `/create` in Chromium).
