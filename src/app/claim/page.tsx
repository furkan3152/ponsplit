"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatEther, parseEventLogs, type Hex } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { ClaimArt, EmptyArt } from "@/components/art";
import { CountUp, Flash, Reveal, celebrate } from "@/components/motion";
import { TokenAvatar } from "@/components/TokenAvatar";
import { XAvatar } from "@/components/XAvatar";
import { feeVaultAbi, launcherAbi } from "@/lib/abi";
import { coinImage } from "@/lib/coin-ui";
import { errorMessage, formatEth, pct, shortAddress } from "@/lib/format";
import { isValidHandle, normalizeHandle } from "@/lib/handles";
import { useClaimsPaused, useCoins, useDebounced, useEarnings, useXProfiles, type Earnings, type XProfileLite } from "@/lib/hooks";
import { useNetwork } from "@/lib/network-context";
import { explorerLink, isLive } from "@/lib/networks";
import { BPS } from "@/lib/pons";
import { useServerConfig } from "@/lib/useServerConfig";
import { HeadingDoodle } from "@/components/art/Doodles";

type Msg = { kind: "ok" | "err"; text: string; tx?: string } | null;
type SigResponse = { error?: string; xId: string; username: string; deadline: string; signature: Hex; claimable: string };
type StepState = "done" | "active" | "todo";
type LookupState = "idle" | "invalid" | "loading" | "found" | "missing" | "error";

/** The account colors, in split order, as the coin page draws a fee split. */
const ACCOUNT_COLORS = ["var(--sky)", "var(--pink)", "var(--sun)", "var(--lilac)", "var(--orange)"];
const colorOf = (i: number) => ACCOUNT_COLORS[i % ACCOUNT_COLORS.length];

/**
 * The claim flow's layout: one column on phones (steps, then the ticket), and from `lg` up the
 * steps on the left with the ticket beside them, following the scroll. `grid-cols-1` (not an
 * implicit auto column) so a long line inside can never widen the page.
 */
const FLOW_GRID = "grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-x-8";
const TICKET_CELL = "lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1";

/** Everything an account can take right now: its vault balance plus fees its coins hold for it (collected in the same transaction). */
const total = (e: Earnings | undefined) => (e ? e.claimable + e.pending : undefined);

/**
 * Asks the server for a claim signature, then sends the claim: through the launcher's
 * collectAndClaim when the account's coins hold fees not collected yet (so they are included),
 * straight to FeeVault otherwise.
 */
function useClaim(earnings: Earnings | undefined, onDone: () => void) {
  const n = useNetwork();
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: n.chain.id });
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const inFlight = useRef(false);

  async function claim(extra: { proofUrl?: string } = {}) {
    setMsg(null);
    if (!isConnected || !address) return openConnectModal?.();
    if (!isLive(n) || !publicClient || inFlight.current) return;
    inFlight.current = true;
    try {
      if (chainId !== n.chain.id) {
        setBusy("Switching network…");
        await switchChainAsync({ chainId: n.chain.id });
      }
      setBusy(extra.proofUrl ? "Checking your post…" : "Getting signature…");
      const res = await fetch("/api/claim-signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ network: n.id, to: address, ...extra }),
      });
      const data = (await res.json()) as SigResponse;
      if (!res.ok) throw new Error(data.error || "Could not get a claim signature");
      const xId = BigInt(data.xId);
      const args = [xId, address, BigInt(data.deadline), data.signature] as const;
      // The signature may be for another account than the one typed in (the post decides): only
      // collect the typed account's coins when it's the same one.
      const collect = earnings && earnings.xId === xId ? earnings.collect : [];
      if (collect.length === 0 && BigInt(data.claimable) === 0n) throw new Error(`Nothing to claim for @${data.username} yet.`);

      // Collecting first is the norm; if it wouldn't go through (a coin's fees held by pons, say)
      // but the vault already holds something, claim that alone rather than fail.
      let useCollect = collect.length > 0;
      if (useCollect) {
        setBusy("Checking the claim…");
        const ok = await publicClient
          .simulateContract({ account: address, address: n.launcher!, abi: launcherAbi, functionName: "collectAndClaim", args: [collect, ...args] })
          .then(() => true)
          .catch(() => false);
        if (!ok) {
          if (BigInt(data.claimable) === 0n) throw new Error(`Nothing can be claimed for @${data.username} right now: its fees are still being released by pons. Try again a little later.`);
          useCollect = false;
        }
      }

      setBusy("Confirm in your wallet…");
      const hash = useCollect
        ? await writeContractAsync({ address: n.launcher!, abi: launcherAbi, chainId: n.chain.id, functionName: "collectAndClaim", args: [collect, ...args] })
        : await writeContractAsync({ address: n.feeVault!, abi: feeVaultAbi, chainId: n.chain.id, functionName: "claim", args });
      setBusy("Claiming…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      // The vault pays whatever has accrued by the time the claim lands, so report what its
      // Claimed event says.
      const paid = parseEventLogs({ abi: feeVaultAbi, eventName: "Claimed", logs: receipt.logs }).find(
        (l) => l.address.toLowerCase() === n.feeVault!.toLowerCase()
      )?.args.amount;
      setMsg({ kind: "ok", text: `Sent ${formatEth(paid ?? BigInt(data.claimable), 6)} ETH to your wallet.`, tx: hash });
      celebrate().catch(() => {});
      onDone();
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  }
  return { claim, busy, msg, address, isConnected };
}

/** Where an X username lookup stands, from what has been typed and what the resolver said. */
function lookupState(
  input: string,
  valid: boolean,
  prof: XProfileLite | null | undefined,
  data: Record<string, XProfileLite | null> | undefined,
  error: Error | null
): LookupState {
  if (!input.trim()) return "idle";
  if (!valid) return "invalid";
  if (prof) return "found";
  if (data && prof === null) return "missing";
  if (error) return "error";
  return "loading";
}

/** CountUp format for an ETH amount: six decimals while it counts, then exactly what formatEth shows. */
function ethTicker(wei: bigint | undefined) {
  const target = wei === undefined ? 0 : Number(formatEther(wei));
  const final = wei === undefined ? "–" : formatEth(wei, 6);
  return (n: number) =>
    Math.abs(n - target) <= Math.max(Math.abs(target) * 1e-9, 1e-12)
      ? final
      : Math.max(0, n).toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
}

export default function ClaimPage() {
  const n = useNetwork();
  const { data: session, status } = useSession();
  const x = session?.x;
  const paused = useClaimsPaused();

  return (
    <div className="pt-2 sm:pt-4">
      <Hero paused={paused === true} />
      <div className="mt-8 space-y-5 sm:mt-12">
        {paused ? <PausedNotice /> : null}
        {!isLive(n) ? <NotLiveNotice /> : null}
        {status === "loading" ? <FlowSkeleton /> : x ? <SessionClaim x={x} /> : <ProofClaim />}
      </div>
      <Lookup />
    </div>
  );
}

function Hero({ paused }: { paused: boolean }) {
  const n = useNetwork();
  return (
    <div className="relative">
      <div aria-hidden className="bg-grid pointer-events-none absolute -inset-x-4 -top-8 -z-10 h-[340px] sm:-inset-x-6 sm:h-[400px]" />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 sm:gap-x-10">
        {/* Phones: the pill and the intro span both columns and the art sits beside the title. From sm up the text is one column. */}
        <div className="contents sm:block sm:min-w-0">
          <Reveal className="col-span-2">
            <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
              <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${paused ? "bg-down" : "animate-pulse-dot bg-lime"}`} />
              <span className="truncate">
                {paused ? "Claims paused" : "Fee vault"} · {n.chain.name}
              </span>
            </span>
          </Reveal>
          <Reveal as="h1" delay={60} className="display col-start-1 mt-5 text-[44px] leading-[0.92] sm:text-[64px]">
            Claim your <span className="accent text-neon pr-1.5">fees</span>
          </Reveal>
          <Reveal delay={120} className="col-span-2">
            <p className="mt-4 max-w-md text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">
              Coins that list your X account send you part of every trade. Prove the account is yours and collect, on {n.label.toLowerCase()}.
            </p>
          </Reveal>
        </div>
        <Reveal delay={180} className="col-start-2 row-start-2 sm:row-start-1">
          <ArtStage />
        </Reveal>
      </div>
    </div>
  );
}

/** The claim illustration on a little stage: neon glow, a slowly turning dotted orbit, floating. */
function ArtStage() {
  return (
    <div className="relative isolate aspect-square w-[112px] sm:w-[188px] md:w-[228px]">
      <div aria-hidden className="absolute inset-[16%] -z-10 rounded-full bg-lime opacity-20 blur-2xl" />
      {/* The orbit turns inside its svg, so the square box never swings wider than the page. */}
      <svg aria-hidden viewBox="0 0 100 100" className="absolute inset-0 -z-10 h-full w-full">
        <g className="origin-center animate-spin-slow">
          <circle cx={50} cy={50} r={48.5} fill="none" stroke="var(--line-2)" strokeWidth={0.8} strokeDasharray="0.4 3.2" strokeLinecap="round" />
        </g>
      </svg>
      <svg aria-hidden viewBox="0 0 100 100" className="absolute inset-0 -z-10 h-full w-full">
        <circle cx={50} cy={50} r={39} fill="none" stroke="var(--line)" strokeWidth={0.6} strokeDasharray="2 4" />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <ClaimArt className="w-[92%] animate-float" />
      </div>
    </div>
  );
}

function PausedNotice() {
  return (
    <Reveal>
      <div className="flex items-start gap-3 rounded-[22px] border border-line bg-down-soft p-4 sm:items-center sm:p-5">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-down text-down-ink">
          <PauseIcon />
        </span>
        <p className="text-[14px] font-medium leading-relaxed text-down-ink">
          Claims are paused by the owner for maintenance. Your balance is safe in the vault and can be claimed once they resume.
        </p>
      </div>
    </Reveal>
  );
}

function NotLiveNotice() {
  const n = useNetwork();
  return (
    <Reveal>
      <div className="rounded-[22px] border border-line bg-card-2 p-4 text-[14px] leading-relaxed text-ink-2 sm:p-5">
        SplitEarn isn&apos;t live on {n.label.toLowerCase()} yet, so there is nothing to claim here. Switch networks at the top of the page.
      </div>
    </Reveal>
  );
}

function FlowSkeleton() {
  return (
    <div className={FLOW_GRID} aria-hidden>
      <div className="space-y-4 sm:space-y-5">
        <div className="card h-44 animate-pulse" />
        <div className="card h-32 animate-pulse" />
      </div>
      <div className="card h-80 animate-pulse rounded-[28px]" />
    </div>
  );
}

/** One step of the proof flow. Done steps stamp their number in neon; the current one is lit. */
function StepCard({ n, title, state, delay = 0, children }: { n: number; title: string; state: StepState; delay?: number; children: ReactNode }) {
  const done = state === "done";
  const active = state === "active";
  return (
    <Reveal delay={delay} className="lg:col-start-1">
      <section
        className={`card relative isolate overflow-hidden p-5 transition-[border-color,box-shadow] duration-500 sm:p-6 ${
          active ? "border-[var(--line-2)] shadow-glow" : ""
        }`}
      >
        <span
          key={done ? "done" : "todo"}
          aria-hidden
          className={`display pointer-events-none absolute right-4 top-3 -z-10 select-none text-[56px] leading-none tracking-normal sm:right-6 sm:top-4 sm:text-[72px] ${
            done ? "text-neon animate-stamp" : "text-transparent"
          }`}
          style={done ? undefined : { WebkitTextStroke: "1px var(--line-2)" }}
        >
          0{n}
        </span>
        {active ? <span aria-hidden className="absolute bottom-6 left-0 top-6 w-[3px] rounded-r-full bg-lime shadow-[0_0_14px_var(--glow)]" /> : null}
        <div className="pr-16 sm:pr-24">
          <div className="eyebrow">
            Step {n} of 4{done ? <span className="text-up-ink"> · done</span> : active ? <span className="text-ink"> · now</span> : null}
          </div>
          <h2 className="display mt-1.5 text-[24px] leading-[1.05] sm:text-[28px]">{title}</h2>
        </div>
        <div className="mt-4">{children}</div>
      </section>
    </Reveal>
  );
}

/** Default flow: prove the account by posting a one-time code. Needs no X developer app. */
function ProofClaim() {
  const server = useServerConfig();
  const [input, setInput] = useState("");
  const [proof, setProof] = useState<{ text: string; intentUrl: string; for: string } | null>(null);
  const [postUrl, setPostUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const handle = normalizeHandle(input);
  const valid = isValidHandle(handle);
  // Look the profile up once typing pauses; the proof itself doesn't depend on this lookup.
  const lookupHandle = useDebounced(valid ? handle : "");
  const profiles = useXProfiles(lookupHandle ? [lookupHandle] : [], { recheckMisses: true });
  const prof = valid && lookupHandle === handle ? profiles.data?.[handle] : undefined;
  const xId = prof ? BigInt(prof.id) : undefined;
  const earnings = useEarnings(xId);
  const { claim, busy, msg, address, isConnected } = useClaim(earnings.data, () => earnings.refetch());
  const { openConnectModal } = useConnectModal();
  const proofKey = `${handle}|${address}`;
  const currentProof = proof?.for === proofKey ? proof : null;

  async function getProof() {
    setErr(null);
    try {
      const res = await fetch("/api/x/proof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, wallet: address }),
      });
      const body = (await res.json().catch(() => ({}))) as { text?: string; intentUrl?: string; error?: string };
      if (!res.ok || !body.text || !body.intentUrl) return setErr(body.error || "Could not create a proof");
      setProof({ text: body.text, intentUrl: body.intentUrl, for: proofKey });
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  // Everything below only draws the flow: which steps are done and which one is next.
  const lookup = lookupState(input, valid, prof, profiles.data, profiles.error);
  const claimable = total(earnings.data);
  const linkIn = Boolean(postUrl.trim());
  const done = [lookup === "found" || (lookup === "error" && lookupHandle === handle), isConnected, Boolean(currentProof) || linkIn, linkIn];
  const next = done.findIndex((d) => !d);
  const stateOf = (i: number): StepState => (done[i] ? "done" : i === next ? "active" : "todo");
  const alt = Boolean(server?.xLogin);

  return (
    <div className={FLOW_GRID}>
      <StepCard n={1} title="Your X account" state={stateOf(0)}>
        <div className="relative">
          <input
            className="input pr-12 text-[16px]"
            placeholder="@username"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Your X username"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className="pointer-events-none absolute right-4 top-1/2 flex -translate-y-1/2">
            <LookupMark state={lookup} />
          </span>
        </div>
        {prof ? (
          <div key={handle} className="mt-3 flex animate-slide-up items-center gap-3 rounded-2xl border border-line bg-card-2 p-3">
            <XAvatar handle={handle} image={prof.image} size={44} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">{prof.name}</div>
              <div className="truncate font-mono text-[12px] text-ink-2">
                @{handle}
                {/* On phones the ticket sits below the steps, so show what is waiting right away. */}
                {claimable !== undefined ? <span className="lg:hidden"> · {formatEth(claimable, 6)} ETH unclaimed</span> : null}
              </div>
            </div>
          </div>
        ) : valid && profiles.data && prof === null ? (
          <p className="mt-2.5 text-[13px] text-down-ink">Couldn&apos;t find @{handle} on X. Check the spelling.</p>
        ) : valid && profiles.error ? (
          <p className="mt-2.5 text-[13px] text-ink-2">Couldn&apos;t look up @{handle} right now. You can still create and verify your proof post.</p>
        ) : null}
      </StepCard>

      <StepCard n={2} title="Wallet to receive the ETH" state={stateOf(1)} delay={80}>
        {isConnected ? (
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-card-2 px-4 py-3">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-up shadow-[0_0_10px_var(--green)]" />
            <p className="num min-w-0 break-all text-[13.5px] leading-snug">{address}</p>
          </div>
        ) : (
          <button className="btn-primary" onClick={openConnectModal}>
            Connect wallet
          </button>
        )}
      </StepCard>

      <StepCard n={3} title="Post this on X" state={stateOf(2)} delay={160}>
        {!currentProof ? (
          <div className="space-y-3">
            <p className="text-[14px] leading-relaxed text-ink-2">
              A short post that names your wallet and carries a one-time code. Posting it from the account proves it&apos;s yours.
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button className="btn-primary" disabled={!valid || prof === null || !isConnected} onClick={getProof}>
                Create my proof post
              </button>
              {!valid || !isConnected ? <span className="font-mono text-[11.5px] text-ink-3">Needs steps 1 and 2</span> : null}
            </div>
          </div>
        ) : (
          <div className="animate-slide-up space-y-3">
            <PostPreview handle={handle} name={prof?.name} image={prof?.image} photo={Boolean(prof)} text={currentProof.text} />
            <div className="flex flex-wrap gap-2">
              <a className="btn-primary" href={currentProof.intentUrl} target="_blank" rel="noreferrer">
                <XLogo className="h-3.5 w-3.5" />
                Post on X
              </a>
              <CopyButton text={currentProof.text} />
            </div>
            <p className="text-[12px] leading-relaxed text-ink-2">
              Post it from @{handle} exactly as shown, as a new post (not a reply or quote). You can delete it after claiming. It only works for the wallet it
              names and expires tomorrow. Never post a proof text someone else sends you.
            </p>
          </div>
        )}
        {err ? <p className="mt-2.5 text-[13px] text-down-ink">{err}</p> : null}
      </StepCard>

      <StepCard n={4} title="Paste the link to your post" state={stateOf(3)} delay={240}>
        <input
          className="input text-[16px]"
          placeholder="https://x.com/you/status/…"
          value={postUrl}
          onChange={(e) => setPostUrl(e.target.value)}
          aria-label="Link to your post"
          inputMode="url"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <p className="mt-2 font-mono text-[11.5px] text-ink-3">On X: Share → Copy link, then paste it here.</p>
      </StepCard>

      <Reveal delay={120} className={`${TICKET_CELL} ${alt ? "lg:row-span-5" : "lg:row-span-4"}`}>
        <ClaimTicket
          known={Boolean(prof)}
          claimable={prof ? claimable : undefined}
          pending={prof ? earnings.data?.pending : undefined}
          waiting={prof ? earnings.data?.waiting : undefined}
          earned={prof ? earnings.data?.earned : undefined}
          account={prof ? `@${handle}` : undefined}
          wallet={isConnected ? address : undefined}
          msg={msg}
          empty="Type your X username in step 1 to see what the vault holds for it."
        >
          <button
            className={`btn-sticker w-full py-3.5 text-[16px] ${busy ? "disabled:opacity-100" : ""}`}
            disabled={Boolean(busy) || (isConnected && !postUrl.trim()) || claimable === 0n}
            aria-busy={Boolean(busy)}
            onClick={() => claim({ proofUrl: postUrl.trim() })}
          >
            {busy ? <Spinner /> : null}
            {!isConnected ? "Connect wallet" : busy ?? (claimable === 0n ? "Nothing to claim yet" : "Verify & claim")}
          </button>
        </ClaimTicket>
      </Reveal>

      {alt ? (
        <Reveal delay={300} className="lg:col-start-1">
          <AltLogin />
        </Reveal>
      ) : null}
    </div>
  );
}

/** The proof post as it will appear on X; the one-time code is marked. */
function PostPreview({ handle, name, image, photo, text }: { handle: string; name?: string; image?: string; photo: boolean; text: string }) {
  return (
    <figure className="rounded-2xl border border-line bg-card-2 p-4">
      <figcaption className="flex items-center gap-2.5">
        <XAvatar handle={handle} image={image} size={36} photo={photo} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[14px] font-semibold">{name ?? handle}</div>
          <div className="truncate font-mono text-[11.5px] text-ink-3">@{handle}</div>
        </div>
        <XLogo className="h-4 w-4 shrink-0 text-ink-3" />
      </figcaption>
      <pre className="mt-3 whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink [overflow-wrap:anywhere]">
        {text.split(/(PE-[0-9A-F]+)/).map((part, i) =>
          i % 2 ? (
            <mark key={i} className="rounded bg-lime-soft px-1 text-ink">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </pre>
    </figure>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <button className="btn-secondary" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})}>
      {copied ? <CheckIcon className="h-4 w-4 text-up-ink" /> : <CopyIcon className="h-4 w-4" />}
      {copied ? "Copied" : "Copy text"}
    </button>
  );
}

function AltLogin() {
  return (
    <div className="flex flex-col gap-4 rounded-[22px] border border-dashed border-line-2 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="min-w-0">
        <div className="eyebrow">Or</div>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-2">Skip the post and sign in with X instead.</p>
      </div>
      <button className="btn-secondary px-4 py-2.5 text-[14px]" onClick={() => signIn("twitter")}>
        <XLogo className="h-3.5 w-3.5" />
        Sign in with X
      </button>
    </div>
  );
}

/** Signed in through X OAuth. */
function SessionClaim({ x }: { x: { id: string; username: string; name?: string; image?: string } }) {
  const xId = BigInt(x.id);
  const earnings = useEarnings(xId);
  const { claim, busy, msg, address, isConnected } = useClaim(earnings.data, () => earnings.refetch());
  const claimable = total(earnings.data);

  return (
    <div className={FLOW_GRID}>
      <Reveal className="lg:col-start-1">
        <section className="card relative isolate overflow-hidden p-5 sm:p-6">
          <div aria-hidden className="absolute -left-16 -top-20 -z-10 h-52 w-52 rounded-full bg-sky opacity-[0.08] blur-3xl" />
          <div className="flex items-center justify-between gap-3">
            <div className="eyebrow">Signed in with X</div>
            <button className="btn-secondary min-h-10 px-4 py-2 text-[13px]" onClick={() => signOut({ redirect: false })}>
              Sign out
            </button>
          </div>
          <div className="mt-5 flex items-center gap-4">
            <XAvatar handle={x.username} image={x.image} size={64} />
            <div className="min-w-0 flex-1">
              <h2 className="display truncate text-[28px] leading-tight sm:text-[32px]">{x.name || x.username}</h2>
              <div className="truncate font-mono text-[12.5px] text-ink-2">
                @{x.username} · X id {x.id}
              </div>
            </div>
          </div>
          <p className="mt-5 border-t border-line pt-4 text-[14px] leading-relaxed text-ink-2">
            Fees follow your permanent X id, so they stay yours even if you rename the account.
          </p>
        </section>
      </Reveal>

      <Reveal delay={100} className={`${TICKET_CELL} lg:row-span-2`}>
        <ClaimTicket
          known
          claimable={claimable}
          pending={earnings.data?.pending}
          waiting={earnings.data?.waiting}
          earned={earnings.data?.earned}
          account={`@${x.username}`}
          wallet={isConnected ? address : undefined}
          msg={msg}
        >
          <button
            className={`btn-sticker w-full py-3.5 text-[16px] ${busy ? "disabled:opacity-100" : ""}`}
            disabled={Boolean(busy) || (isConnected && !claimable)}
            aria-busy={Boolean(busy)}
            onClick={() => claim()}
          >
            {busy ? <Spinner /> : null}
            {!isConnected ? "Connect wallet to claim" : busy ?? (claimable ? `Claim to ${shortAddress(address!)}` : "Nothing to claim yet")}
          </button>
        </ClaimTicket>
      </Reveal>

      <Reveal delay={160} className="lg:col-start-1">
        <section className="card p-5 sm:p-6">
          <StreamsList xId={xId} username={x.username} level={2} />
        </section>
      </Reveal>
    </div>
  );
}

/**
 * The one hero card on the page: what the vault holds for the account, as a receipt with the
 * claim button at the bottom. Stamped "paid" once a claim lands.
 */
function ClaimTicket({
  known,
  claimable,
  pending,
  waiting,
  earned,
  account,
  wallet,
  msg,
  empty,
  children,
}: {
  /** An account is chosen, so there is a balance to show (else a placeholder and `empty`). */
  known: boolean;
  /** What a claim would pay now: the vault balance plus fees still in the account's coins. */
  claimable?: bigint;
  /** The part of `claimable` still held by the coins (collected by the claim itself). */
  pending?: bigint;
  /** Earned in a graduated coin's pool but held by pons until its keeper converts the coin-side fees. */
  waiting?: bigint;
  earned?: bigint;
  account?: string;
  wallet?: string;
  msg: Msg;
  empty?: string;
  children: ReactNode;
}) {
  return (
    <aside aria-label="Your claim" className="card ring-glow relative rounded-[28px] p-5 sm:p-6">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
        <div className="bg-grid absolute inset-0" />
        <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-lime opacity-[0.14] blur-3xl" />
      </div>
      {msg?.kind === "ok" ? (
        <span
          key={msg.tx}
          aria-hidden
          className="pointer-events-none absolute right-5 top-16 z-10 animate-stamp rounded-xl border-[2.5px] border-up px-3 py-1 font-display text-[22px] font-extrabold uppercase leading-none tracking-[0.06em] text-up-ink sm:right-6"
        >
          Paid
        </span>
      ) : null}

      {known ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="eyebrow">Ready to claim</div>
            <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
              <span aria-hidden className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-lime" />
              Live
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <CountUp
              value={claimable === undefined ? undefined : Number(formatEther(claimable))}
              format={ethTicker(claimable)}
              className="num text-neon min-w-0 break-all text-[44px] font-semibold leading-none tracking-[-0.04em] sm:text-[52px]"
            />
            <span className="font-mono text-[14px] font-medium text-ink-2">ETH</span>
          </div>
          <p className="mt-3 font-mono text-[12px] text-ink-3">
            {earned === undefined ? (
              "Reading the vault…"
            ) : (
              <>
                <Flash value={earned + (pending ?? 0n) + (waiting ?? 0n)} className="px-0.5 text-ink-2">
                  {formatEth(earned + (pending ?? 0n) + (waiting ?? 0n), 6)} ETH
                </Flash>{" "}
                earned all-time
              </>
            )}
          </p>
          {pending ? (
            <p className="mt-1.5 font-mono text-[12px] text-ink-3">
              incl. <span className="text-ink-2">{formatEth(pending, 6)} ETH</span> still in its coins, collected when you claim
            </p>
          ) : null}
          {waiting ? (
            <p className="mt-1.5 font-mono text-[12px] text-ink-3">
              + <span className="text-ink-2">{formatEth(waiting, 6)} ETH</span> being released by pons (claimable once it is)
            </p>
          ) : null}
        </>
      ) : (
        <>
          <div className="eyebrow">Your vault</div>
          <div
            aria-hidden
            className="num mt-3 select-none text-[44px] font-semibold leading-none tracking-normal text-transparent sm:text-[52px]"
            style={{ WebkitTextStroke: "1px var(--line-2)" }}
          >
            0.000000
          </div>
          {empty ? <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{empty}</p> : null}
        </>
      )}

      <dl className="mt-5 space-y-2 border-t border-dashed border-line-2 pt-4 font-mono text-[12px]">
        <ReceiptRow label="Account" value={account ?? "—"} />
        <ReceiptRow label="Pays out to" value={wallet ? shortAddress(wallet) : "No wallet yet"} />
      </dl>
      <div className="mt-5 space-y-3">
        {children}
        <Result key={msg ? `${msg.kind}:${msg.text}` : "none"} msg={msg} />
      </div>
    </aside>
  );
}

/** A receipt line: label, dotted leader, value. */
function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="flex min-w-0 flex-1 items-baseline gap-2 whitespace-nowrap text-ink-3 after:h-0 after:min-w-3 after:flex-1 after:-translate-y-[3px] after:border-b after:border-dotted after:border-line-2 after:content-['']">
        {label}
      </dt>
      <dd className="max-w-[62%] truncate text-ink">{value}</dd>
    </div>
  );
}

function Result({ msg }: { msg: Msg }) {
  const n = useNetwork();
  if (!msg) return null;
  const ok = msg.kind === "ok";
  return (
    <div className={`flex animate-slide-up items-start gap-2.5 rounded-2xl px-4 py-3 ${ok ? "bg-up-soft text-up-ink" : "bg-down-soft text-down-ink"}`}>
      {ok ? <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />}
      <p role="status" className="min-w-0 break-words text-[14px] font-medium leading-snug">
        {msg.text}{" "}
        {msg.tx ? (
          <a className="underline underline-offset-2" href={explorerLink(n, "tx", msg.tx)} target="_blank" rel="noreferrer">
            View transaction
          </a>
        ) : null}
      </p>
    </div>
  );
}

/** Every coin that pays this account: its share of the coin's split and what that has paid so far. */
function StreamsList({ xId, username, level = 3 }: { xId: bigint; username: string; level?: 2 | 3 }) {
  const { data: tokens, error } = useCoins();
  const streams = useMemo(
    () =>
      (tokens ?? [])
        .map((t) => ({ t, i: t.xIds.findIndex((id) => id === xId) }))
        .filter((s) => s.i >= 0)
        .map(({ t, i }) => {
          const bps = t.recipients[i]?.bps ?? 0;
          return { t, i, bps, fromToken: (t.accountsEarned * BigInt(bps)) / BPS };
        }),
    [tokens, xId]
  );
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <Heading className="min-w-0 break-words text-[17px] font-semibold">Fee streams for @{username}</Heading>
        {tokens && streams.length ? <span className="eyebrow shrink-0">Earned so far</span> : null}
      </div>
      {!tokens ? (
        error ? (
          <p className="mt-3 text-[14px] text-ink-2">Couldn&apos;t load fee streams right now. Retrying…</p>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="font-mono text-[12px] text-ink-3">Loading…</p>
            {[0, 1].map((k) => (
              <div key={k} aria-hidden className="h-12 animate-pulse rounded-2xl bg-card-2" />
            ))}
          </div>
        )
      ) : streams.length === 0 ? (
        <div className="mt-4 flex items-center gap-4 rounded-2xl border border-dashed border-line-2 p-4">
          <EmptyArt className="h-14 w-[4.5rem] shrink-0 animate-float" />
          <p className="text-[14px] leading-relaxed text-ink-2">
            No coins list @{username} yet.{" "}
            <Link href="/create" className="font-medium text-ink underline">
              Launch one
            </Link>
          </p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--line)]">
          {streams.map(({ t, i, bps, fromToken }) => (
            <li key={t.token}>
              <Link href={`/token/${t.token}`} className="group -mx-2 flex min-h-[60px] items-center gap-3 rounded-2xl px-2 py-2.5 transition hover:bg-card-2">
                <TokenAvatar src={coinImage(t)} seed={t.token} size={40} className="transition duration-500 group-hover:-rotate-3 group-hover:scale-105" />
                <div className="min-w-0 flex-1 sm:max-w-[48%] sm:flex-none">
                  <div className="truncate text-[15px] font-semibold">{t.name}</div>
                  <div className="flex items-center gap-1.5 font-mono text-[11.5px] text-ink-2">
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(i) }} />
                    {/* The share is what this list is for: only the ticker gives way on narrow phones. */}
                    <span className="min-w-0 truncate">${t.symbol}</span>
                    <span className="shrink-0">· share {pct(bps)}</span>
                  </div>
                </div>
                <FlowLine color={colorOf(i)} />
                <span className="num shrink-0 text-[14px] font-semibold">
                  <Flash value={fromToken} className="px-0.5">
                    {formatEth(fromToken, 5)} Ξ
                  </Flash>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A fee stream: dashes flowing from the coin toward the amount, in the account's color. */
function FlowLine({ color }: { color: string }) {
  return (
    <svg aria-hidden className="hidden h-2 min-w-[24px] flex-1 overflow-visible sm:block">
      <line x1="4" y1="4" x2="100%" y2="4" stroke={color} strokeOpacity={0.22} strokeWidth={2} strokeLinecap="round" />
      <line x1="4" y1="4" x2="100%" y2="4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeDasharray="2 6" className="animate-flow" />
    </svg>
  );
}

function Lookup() {
  const [input, setInput] = useState("");
  const handle = normalizeHandle(input);
  const valid = isValidHandle(handle);
  // Look the profile up once typing pauses.
  const lookupHandle = useDebounced(valid ? handle : "");
  const profiles = useXProfiles(lookupHandle ? [lookupHandle] : [], { recheckMisses: true });
  const prof = valid && lookupHandle === handle ? profiles.data?.[handle] : undefined;
  const { data } = useEarnings(prof ? BigInt(prof.id) : undefined);
  const n = useNetwork();
  const state = lookupState(input, valid, prof, profiles.data, profiles.error);
  const line = {
    idle: "Type a username to read its vault.",
    invalid: "That doesn't look like an X username.",
    loading: `Looking up @${handle}…`,
    found: `@${handle} · X id ${prof?.id ?? ""}`,
    missing: `Couldn't find @${handle} on X. Check the spelling.`,
    error: "Lookup unavailable right now.",
  }[state];

  return (
    <section className="mt-20 space-y-6 sm:mt-28">
      <Reveal className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <div className="eyebrow">Anyone&apos;s vault</div>
          <h2 className="display mt-1 flex items-center gap-2 text-[30px] leading-none sm:text-[36px]">
            <label htmlFor="lookup">Check any X account</label>
            <HeadingDoodle kind="star" />
          </h2>
        </div>
        <p className="max-w-sm text-[14px] leading-relaxed text-ink-2">See what an account has waiting in the vault, what it has earned, and every coin that pays it.</p>
      </Reveal>
      <Reveal delay={90}>
        <div className="card overflow-hidden rounded-[26px]">
          <div className="flex items-center gap-2.5 border-b border-line bg-card-2 px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3 sm:px-6">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse-dot rounded-full bg-lime" />
            <span>Vault lookup</span>
            <span className="ml-auto hidden truncate sm:block">Read live from {n.chain.name}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <div className="p-4 sm:p-6">
              <div className="flex items-center gap-3 rounded-2xl border border-line bg-card-2 pl-4 pr-3.5 transition focus-within:border-[var(--line-2)] focus-within:bg-card focus-within:ring-4 focus-within:ring-[var(--lime-soft)]">
                <span aria-hidden className="font-mono text-[18px] font-bold leading-none text-lime [[data-theme=light]_&]:text-ink">
                  ›
                </span>
                <input
                  id="lookup"
                  className="min-w-0 flex-1 bg-transparent py-3.5 font-mono text-[16px] text-ink outline-none placeholder:text-ink-3"
                  placeholder="@username"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <LookupMark state={state} />
              </div>
              <p className={`mt-3 font-mono text-[12px] leading-relaxed ${state === "missing" || state === "error" ? "text-ink-2" : "text-ink-3"}`}>{line}</p>
              {prof ? (
                <div key={handle} className="mt-5 animate-slide-up">
                  <div className="flex items-center gap-3.5">
                    <XAvatar handle={handle} image={prof.image} size={52} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[17px] font-semibold">{prof.name}</div>
                      <div className="truncate font-mono text-[12px] text-ink-2">@{handle}</div>
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 divide-x divide-[var(--line)] overflow-hidden rounded-2xl border border-line bg-card-2">
                    <Readout label="Claimable" value={total(data)} strong />
                    <Readout label="Earned all-time" value={data ? data.earned + data.pending + data.waiting : undefined} />
                  </dl>
                </div>
              ) : null}
            </div>
            <div className={`border-t border-line p-4 sm:p-6 lg:border-l lg:border-t-0 ${prof ? "" : "hidden lg:block"}`}>
              {prof ? <StreamsList xId={BigInt(prof.id)} username={handle} /> : <IdleStreams />}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Readout({ label, value, strong }: { label: string; value: bigint | undefined; strong?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <dt className="eyebrow truncate">{label}</dt>
      <dd className={`num mt-1.5 text-[16px] font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-[20px] ${strong ? "text-ink" : "text-ink-2"}`}>
        {value === undefined ? (
          "…"
        ) : (
          <Flash value={value} className="px-0.5">
            {formatEth(value, 6)}
          </Flash>
        )}
        <span className="ml-1 text-[11px] font-medium text-ink-3">ETH</span>
      </dd>
    </div>
  );
}

const IDLE_SOURCES = [
  { y: 12, color: "var(--sky)" },
  { y: 36, color: "var(--pink)" },
  { y: 60, color: "var(--sun)" },
];

/** Before a lookup: what the pane will show, drawn as three coins streaming fees to one account. */
function IdleStreams() {
  return (
    <div className="flex h-full min-h-[240px] flex-col">
      <div className="eyebrow">Fee streams</div>
      <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-ink-2">
        Every coin that pays the account shows up here, with its share of the split and what it has paid so far.
      </p>
      <svg aria-hidden viewBox="0 0 320 72" className="my-6 h-[72px] w-full">
        {IDLE_SOURCES.map((s, i) => {
          const d = `M20 ${s.y}C140 ${s.y} 170 36 286 36`;
          return (
            <g key={s.y}>
              <path d={d} fill="none" stroke={s.color} strokeOpacity={0.22} strokeWidth={3} strokeLinecap="round" />
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeDasharray="3 5" className="animate-flow" style={{ animationDuration: `${1.4 + i * 0.25}s` }} />
              <circle cx={12} cy={s.y} r={6} fill={s.color} stroke="var(--outline)" strokeWidth={1.8} />
            </g>
          );
        })}
        <circle cx={300} cy={36} r={12} fill="var(--lime)" stroke="var(--outline)" strokeWidth={2} />
        <text x={300} y={40} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--lime-ink)">
          Ξ
        </text>
      </svg>
      <p className="mt-auto font-mono text-[12px] text-ink-3">
        › waiting for a username
        <span aria-hidden className="ml-1 inline-block h-3.5 w-[7px] translate-y-[2px] animate-pulse bg-lime" />
      </p>
    </div>
  );
}

function LookupMark({ state }: { state: LookupState }) {
  if (state === "loading") return <Spinner className="h-4 w-4 text-ink-3" />;
  if (state === "found") return <CheckIcon className="h-4 w-4 shrink-0 text-up-ink" />;
  if (state === "missing") return <AlertIcon className="h-4 w-4 shrink-0 text-down-ink" />;
  return null;
}

const icon = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...icon} className={className}>
      <path d="M5 12.5l4.2 4.2L19 7" />
    </svg>
  );
}

function AlertIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...icon} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </svg>
  );
}

function CopyIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...icon} className={className}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg {...icon} className="h-4 w-4">
      <path d="M9 6.5v11M15 6.5v11" />
    </svg>
  );
}

function XLogo({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}
