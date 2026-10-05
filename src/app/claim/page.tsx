"use client";

import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useMemo, useState } from "react";
import { ClaimArt, EmptyArt } from "@/components/art";
import { HeadingDoodle } from "@/components/art/Doodles";
import { GithubAvatar } from "@/components/GithubAvatar";
import { CountUp, Reveal } from "@/components/motion";
import { TokenAvatar } from "@/components/TokenAvatar";
import { coinImage } from "@/lib/coin-ui";
import { errorMessage, formatSol, pct } from "@/lib/format";
import { githubProfileUrl, isValidLogin, normalizeLogin } from "@/lib/github-handles";
import { useClaimable, useCoins, useDebounced, useGithubProfiles } from "@/lib/hooks";
import { distributeTransaction } from "@/lib/solana/pump";

/** Where GitHub accounts claim on pump.fun (it signs claims for GitHub accounts after a GitHub sign-in). */
const PUMP_CLAIM_URL = "https://pump.fun";

/**
 * GitHub developers get paid through pump.fun: each Splidev coin sends their share of its creator
 * fees to their pump.fun GitHub account, and they claim it on pump.fun after signing in with
 * GitHub. This page finds what a username has waiting, can push the coins' pending fees into it,
 * and links to pump.fun for the claim.
 */
export default function ClaimPage() {
  const [input, setInput] = useState("");
  const login = normalizeLogin(useDebounced(input, 400));
  const valid = isValidLogin(login);
  const profiles = useGithubProfiles(valid ? [login] : []);
  const profile = valid ? profiles.data?.[login] : undefined;
  const claimable = useClaimable(profile?.id);
  const { data: coins } = useCoins();
  const mine = useMemo(
    () =>
      profile
        ? (coins ?? [])
            .map((c) => ({ coin: c, r: c.recipients.find((r) => r.githubId === profile.id) }))
            .filter((x): x is { coin: (typeof x)["coin"]; r: NonNullable<(typeof x)["r"]> } => Boolean(x.r))
        : [],
    [coins, profile]
  );
  const pendingTotal = mine.reduce((a, { coin, r }) => a + (coin.pendingFees * BigInt(r.shareBps)) / 10_000n, 0n);

  return (
    <div className="mx-auto max-w-5xl space-y-8 pt-2 sm:pt-4">
      <header className="relative">
        <div aria-hidden className="bg-grid pointer-events-none absolute -inset-x-4 -top-8 -z-10 h-[320px] sm:-inset-x-6" />
        <div className="flex items-end justify-between gap-6">
          <div className="min-w-0">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-lime" aria-hidden />
                For GitHub developers
              </span>
            </Reveal>
            <Reveal as="h1" delay={60} className="display mt-5 flex items-center gap-2 text-[44px] leading-[0.92] sm:text-[64px]">
              Get <span className="accent text-neon pr-1.5">paid</span>
              <HeadingDoodle kind="coin" className="h-10 w-10" />
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">
                Coins on Splidev pay GitHub accounts through pump.fun. Type your username to see what&apos;s waiting, then claim it on pump.fun by
                signing in with GitHub.
              </p>
            </Reveal>
          </div>
          <Reveal delay={180} className="hidden shrink-0 sm:block">
            <ClaimArt className="h-36 w-36 animate-float md:h-44 md:w-44" />
          </Reveal>
        </div>
      </header>

      <Reveal as="section" delay={80} className="card p-5 sm:p-7">
        <label htmlFor="gh" className="label">
          GitHub username
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 flex -translate-y-1/2">
            {profile ? <GithubAvatar id={profile.id} login={profile.login} size={32} /> : <span className="h-8 w-8 rounded-full border border-dashed border-line-2" />}
          </span>
          <input
            id="gh"
            className="input h-14 pl-14 text-[17px]"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="your-github-username"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
        <p className="mt-2 min-h-[20px] text-[13px] text-ink-2">
          {!input.trim()
            ? "Any GitHub account works; nobody needs to sign up anywhere for coins to pay them."
            : !valid
              ? "That isn't a GitHub username."
              : profiles.isLoading
                ? "Looking it up…"
                : profiles.error
                  ? (profiles.error as Error).message
                  : profile === null
                    ? "No GitHub account with that name."
                    : profile
                      ? `${profile.name} · GitHub user #${profile.id}`
                      : ""}
        </p>
      </Reveal>

      {profile ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div className="min-w-0 space-y-5">
            <Reveal as="section" className="card p-5 sm:p-6">
              <div className="eyebrow">Step 1 · on the way</div>
              <h2 className="display mt-1.5 text-[26px] leading-none">From Splidev coins</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                Coins keep their creator fees until someone distributes them. Distributing moves @{profile.login}&apos;s share into the pump.fun GitHub account;
                anyone can do it, for the network fee only.
              </p>
              {mine.length === 0 ? (
                <div className="mt-5 flex flex-col items-center gap-2 py-6 text-center">
                  <EmptyArt className="h-16 w-20 animate-float" />
                  <p className="text-[14px] text-ink-2">No Splidev coin pays @{profile.login} yet.</p>
                  <Link href="/create" className="btn-secondary mt-1 px-4 py-2 text-[14px]">
                    Launch one for them
                  </Link>
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-line">
                  {mine.map(({ coin, r }) => (
                    <li key={coin.token} className="flex items-center gap-3 py-3">
                      <TokenAvatar src={coinImage(coin)} seed={coin.token} size={40} />
                      <div className="min-w-0 flex-1">
                        <Link href={`/token/${coin.token}`} className="block truncate text-[14px] font-semibold hover:underline">
                          {coin.name} <span className="font-mono text-[12px] text-ink-2">${coin.symbol}</span>
                        </Link>
                        <div className="num text-[11px] text-ink-3">{pct(r.shareBps)} of its creator fees</div>
                      </div>
                      <span className="num shrink-0 text-[13px] font-semibold text-up-ink">{formatSol((coin.pendingFees * BigInt(r.shareBps)) / 10_000n, 5)} SOL</span>
                    </li>
                  ))}
                </ul>
              )}
              {mine.length ? <DistributeAll mints={mine.filter(({ coin }) => coin.pendingFees > 0n || coin.graduated).map(({ coin }) => coin.token)} onDone={() => claimable.refetch()} /> : null}
            </Reveal>

            <Reveal as="section" delay={60} className="card p-5 sm:p-6">
              <div className="eyebrow">Step 2 · claim</div>
              <h2 className="display mt-1.5 text-[26px] leading-none">On pump.fun, with GitHub</h2>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[14px] leading-relaxed text-ink-2">
                <li>Open pump.fun and connect the Solana wallet you want to be paid in.</li>
                <li>Sign in with GitHub as @{profile.login} (pump.fun checks the account is yours).</li>
                <li>Claim: pump.fun sends everything in your GitHub fee account to your wallet.</li>
              </ol>
              <a href={PUMP_CLAIM_URL} target="_blank" rel="noreferrer" className="btn-neon mt-5 w-full py-3.5 text-[16px]">
                Claim on pump.fun ↗
              </a>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
                Splidev never holds your money: it sits in pump.fun&apos;s GitHub fee account for user #{profile.id} until you claim it there.
              </p>
            </Reveal>
          </div>

          <Reveal as="aside" delay={120} className="card ring-glow p-5 lg:sticky lg:top-24">
            <div className="flex items-center gap-3">
              <GithubAvatar id={profile.id} login={profile.login} size={48} />
              <div className="min-w-0">
                <a href={githubProfileUrl(profile.login)} target="_blank" rel="noreferrer" className="block truncate text-[16px] font-semibold hover:underline">
                  @{profile.login}
                </a>
                <div className="num text-[11px] text-ink-3">pump.fun GitHub account</div>
              </div>
            </div>
            <dl className="mt-5 space-y-3">
              <div>
                <dt className="eyebrow">Ready to claim on pump.fun</dt>
                <dd className="num mt-1 text-[32px] font-semibold leading-none text-up-ink">
                  {claimable.data ? <CountUp value={Number(claimable.data.claimable) / 1e9} format={(v) => v.toLocaleString("en-US", { maximumFractionDigits: 5 })} /> : "…"}{" "}
                  <span className="text-[14px] text-ink-2">SOL</span>
                </dd>
              </div>
              <div className="border-t border-dashed border-line-2 pt-3">
                <dt className="eyebrow">Still in Splidev coins</dt>
                <dd className="num mt-1 text-[18px] font-semibold">{formatSol(pendingTotal, 5)} SOL</dd>
              </div>
            </dl>
            {claimable.data && !claimable.data.exists ? (
              <p className="mt-3 text-[12px] leading-relaxed text-ink-3">This GitHub account has no pump.fun fee account yet; the first coin that pays it creates one.</p>
            ) : null}
          </Reveal>
        </div>
      ) : null}
    </div>
  );
}

/** Distributes the pending creator fees of several coins (one transaction each, signed together). */
function DistributeAll({ mints, onDone }: { mints: string[]; onDone: () => void }) {
  const { connection } = useConnection();
  const { publicKey, connected, signAllTransactions } = useWallet();
  const { setVisible } = useWalletModal();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!mints.length) return null;
  async function run() {
    setMsg(null);
    if (!connected || !publicKey) return setVisible(true);
    if (!signAllTransactions) return setMsg({ ok: false, text: "This wallet can't sign several transactions at once." });
    try {
      setBusy("Preparing…");
      const txs = await Promise.all(mints.map((m) => distributeTransaction(connection, publicKey, new PublicKey(m))));
      setBusy("Confirm in your wallet…");
      const signed = await signAllTransactions(txs);
      setBusy("Distributing…");
      let failed = 0;
      for (const tx of signed) {
        try {
          const sig = await connection.sendRawTransaction(tx.serialize());
          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
          const r = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
          if (r.value.err) failed++;
        } catch {
          failed++;
        }
      }
      setMsg(failed ? { ok: false, text: `${mints.length - failed} of ${mints.length} distributed; try the rest again.` } : { ok: true, text: "Distributed. It's in the pump.fun GitHub account now." });
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="mt-4 space-y-2 border-t border-dashed border-line-2 pt-4">
      <button className="btn-secondary w-full py-2.5 text-[14px]" disabled={Boolean(busy)} onClick={run}>
        {busy ?? (connected ? `Distribute ${mints.length} coin${mints.length === 1 ? "" : "s"}` : "Connect wallet to distribute")}
      </button>
      {msg ? <p className={`rounded-xl px-3 py-2 text-[13px] ${msg.ok ? "bg-up-soft text-up-ink" : "bg-down-soft text-down-ink"}`}>{msg.text}</p> : null}
    </div>
  );
}
