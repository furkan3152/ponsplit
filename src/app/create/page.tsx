"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { decodeEventLog, formatEther, formatUnits, parseEther, type Hex } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { Progress } from "@/components/Progress";
import { useRiskGate } from "@/components/RiskNotice";
import { TokenAvatar } from "@/components/TokenAvatar";
import { XAvatar, XAvatarStack } from "@/components/XAvatar";
import { StepLaunch } from "@/components/art";
import { Flash, Reveal } from "@/components/motion";
import { launchpadAbi } from "@/lib/abi";
import { activeChain } from "@/lib/chains";
import { BPS, LAUNCHPAD_ADDRESS, MAX_RECIPIENTS } from "@/lib/config";
import { compact, errorMessage, formatEth, pct, progressText, shortAddress, spotPrice } from "@/lib/format";
import { isValidHandle, normalizeHandle } from "@/lib/handles";
import { readLaunchTerms, useDebounced, useLaunchesPaused, useLaunchTerms, useXProfiles, type LaunchTerms } from "@/lib/hooks";
import { encodeMetadata, safeUrl } from "@/lib/metadata";
import { useServerConfig } from "@/lib/useServerConfig";

type Row = { handle: string; percent: string };

/** "12.5" or "12,5" (comma keypads, e.g. an iPhone set to Turkey) → basis points; NaN if invalid. */
function toBps(percent: string): number {
  const v = percent.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(v)) return NaN;
  return Math.round(parseFloat(v) * 100);
}

/** The contract limits lengths in UTF-8 bytes, not characters (emoji and accents take more). */
const byteLength = (v: string) => new TextEncoder().encode(v).length;

function safeParseEther(v: string): bigint | undefined {
  try {
    const n = v.trim() ? parseEther(v.trim()) : 0n;
    // parseEther accepts "-1"; a negative first buy is not a number we can send.
    return n < 0n ? undefined : n;
  } catch {
    return undefined;
  }
}

function evenSplit(n: number): string[] {
  const base = Math.floor(BPS / n);
  return Array.from({ length: n }, (_, i) => ((i === 0 ? base + (BPS - base * n) : base) / 100).toString());
}

/**
 * Tolerance on the creator's first buy. The launch is pinned to the terms version the creator saw
 * (so fees and curve can't change under it) and nobody can trade a coin before it exists, so this
 * only covers a rounding difference between firstBuyTokens and the contract's quoteBuy.
 */
const FIRST_BUY_SLIPPAGE_BPS = 10n;

/** Tokens a first buy of `ethIn` gets on a fresh curve; mirrors SplitLaunchpad.quoteBuy. */
function firstBuyTokens(ethIn: bigint, feeBps: bigint, curve: readonly [bigint, bigint, bigint, bigint]): bigint {
  const [virtualEth, virtualToken, curveSupply] = curve;
  const net = ethIn - (ethIn * feeBps) / BigInt(BPS);
  const out = (virtualToken * net) / (virtualEth + net);
  return out >= curveSupply ? curveSupply : out;
}

/**
 * The account colors, in split order, exactly as the coin page's fee split draws them: accounts
 * past the fifth reuse the five hues, striped, so no two accounts in one split look alike.
 */
const ACCOUNT_COLORS = ["var(--sky)", "var(--pink)", "var(--sun)", "var(--lilac)", "var(--orange)"];
const STRIPES = "repeating-linear-gradient(135deg, transparent 0 3px, rgba(11, 11, 13, 0.3) 3px 5px)";
const colorOf = (i: number) => ACCOUNT_COLORS[i % ACCOUNT_COLORS.length];
const swatch = (i: number): CSSProperties => ({ backgroundColor: colorOf(i), backgroundImage: i >= ACCOUNT_COLORS.length ? STRIPES : undefined });

/**
 * The coin as it looks right after launch: the creator's first buy run through a fresh curve
 * (mirrors SplitLaunchpad.quoteBuy and _buy). Only feeds the live preview.
 */
function simulateLaunch(ethIn: bigint, t: LaunchTerms) {
  const [virtualEth, virtualToken, curveSupply, lpSupply] = t.curve;
  const bps = BigInt(BPS);
  let fee = (ethIn * t.feeBps) / bps;
  let net = ethIn - fee;
  let tokens = (virtualToken * net) / (virtualEth + net);
  const soldOut = tokens >= curveSupply;
  if (soldOut) {
    // Buys the whole curve: only the ETH that takes is spent, the rest is refunded.
    tokens = curveSupply;
    const rest = virtualToken - tokens;
    net = (virtualEth * tokens + rest - 1n) / rest;
    fee = (net * t.feeBps + (bps - t.feeBps) - 1n) / (bps - t.feeBps);
    if (net + fee > ethIn) fee = ethIn - net;
  }
  const supply = curveSupply + lpSupply;
  return {
    tokens,
    soldOut,
    /** What the X accounts earn from the first buy alone. */
    split: fee - (fee * t.protocolShareBps) / bps,
    marketCap: spotPrice(virtualEth + net, virtualToken - tokens) * Number(formatUnits(supply, 18)),
    progress: curveSupply > 0n ? Number((tokens * 10_000n) / curveSupply) / 100 : 0,
    supplyShare: supply > 0n ? Number((tokens * 10_000n) / supply) / 100 : 0,
  };
}

/** The steps `submit` reports while launching, in order, with short labels for the progress rail. */
const STAGES = [
  ["Checking launch terms…", "Terms"],
  ["Verifying X accounts…", "X accounts"],
  ["Confirm in your wallet…", "Wallet"],
  ["Launching…", "Launch"],
] as const;

/** Why the launch button is disabled, and which form section (1-3) the fix belongs to. */
type Issue = { step: 1 | 2 | 3; text: string };

/** Status pill beside a username: under the field on phones, inside it from `sm` up. */
const HANDLE_STATUS =
  "pointer-events-none mt-1.5 block w-fit max-w-full truncate rounded-full px-2 py-0.5 text-[12px] font-medium sm:absolute sm:right-2.5 sm:top-1/2 sm:mt-0 sm:max-w-[8rem] sm:-translate-y-1/2";

export default function CreatePage() {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { writeContractAsync } = useWriteContract();
  const server = useServerConfig();
  const terms = useLaunchTerms();
  const shownTerms = terms.data;
  const creationFee = shownTerms?.creationFee;
  const feeBps = shownTerms?.feeBps;
  const protocolShareBps = shownTerms?.protocolShareBps;
  const paused = useLaunchesPaused();
  const { guard, dialog } = useRiskGate();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [image, setImage] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [telegram, setTelegram] = useState("");
  const [twitter, setTwitter] = useState("");
  const [showLinks, setShowLinks] = useState(false);
  const [rows, setRows] = useState<Row[]>([
    { handle: "", percent: "50" },
    { handle: "", percent: "50" },
  ]);
  const [devBuy, setDevBuy] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // The account being edited or pointed at, so its slice of the split lights up in the preview.
  const [hot, setHot] = useState<number | null>(null);

  const handles = useMemo(() => rows.map((r) => normalizeHandle(r.handle)), [rows]);
  const bps = useMemo(() => rows.map((r) => toBps(r.percent)), [rows]);
  const totalBps = bps.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0);

  // Debounce a string, not an array: a fresh array every render would re-arm the timer forever.
  const lookupKey = useDebounced(handles.filter(isValidHandle).join(","));
  const lookup = useMemo(() => (lookupKey ? lookupKey.split(",") : []), [lookupKey]);
  const profiles = useXProfiles(lookup, { recheckMisses: true });
  const inFlight = useRef(false);

  const imageUrl = image.trim() ? safeUrl(image.trim()) : undefined;

  const metadata = useMemo(
    () => encodeMetadata({ image: image.trim(), description: description.trim(), website: website.trim(), telegram: telegram.trim(), twitter: twitter.trim() }),
    [image, description, website, telegram, twitter]
  );

  const issues = useMemo(() => {
    const p: Issue[] = [];
    const add = (step: Issue["step"], text: string) => p.push({ step, text });
    if (!name.trim()) add(1, "Give your coin a name.");
    else if (byteLength(name.trim()) > 32) add(1, "The name is too long (32 bytes max; emoji and accented letters count double or more).");
    if (!symbol.trim() || byteLength(symbol.trim()) > 10) add(1, "Add a ticker (up to 10 letters or digits).");
    if (byteLength(metadata) > 2000) add(1, "Description and links are too long together; shorten the description.");
    if (image.trim() && !imageUrl) add(1, "Image must be an https:// or ipfs:// link.");
    for (const [label, v] of [["Website", website], ["Telegram", telegram], ["X link", twitter]] as const) {
      if (v.trim() && !safeUrl(v.trim())) add(1, `${label} must be an https:// link.`);
    }
    handles.forEach((h, i) => {
      if (!isValidHandle(h)) add(2, `Account ${i + 1}: enter an X username.`);
      else if (profiles.data && h in profiles.data && profiles.data[h] === null) add(2, `Couldn't find @${h} on X. Check the spelling.`);
    });
    if (new Set(handles).size !== handles.length) add(2, "Each X account can only appear once.");
    if (bps.some((b) => Number.isNaN(b) || b <= 0)) add(2, "Every share must be above 0% (2 decimals max).");
    else if (totalBps !== BPS) add(2, `Shares add up to ${pct(totalBps)}; they need to total 100%.`);
    if (safeParseEther(devBuy) === undefined) add(3, "First buy must be a number.");
    return p;
  }, [name, symbol, metadata, image, imageUrl, website, telegram, twitter, handles, bps, totalBps, devBuy, profiles.data]);
  const problems = useMemo(() => issues.map((p) => p.text), [issues]);

  const touched = Boolean(name || symbol || handles.some(Boolean));

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const body = (await res.json()) as { uri?: string; error?: string };
      if (!res.ok || !body.uri) throw new Error(body.error || "Upload failed");
      setImage(body.uri);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setError(null);
    if (!isConnected || !address) return openConnectModal?.();
    if (!LAUNCHPAD_ADDRESS || !publicClient || problems.length || !shownTerms || inFlight.current) return;
    inFlight.current = true;
    try {
      if (chainId !== activeChain.id) {
        setStatus("Switching network…");
        await switchChainAsync({ chainId: activeChain.id });
      }
      // The launch is priced on the terms shown on this page and pinned to their version on-chain,
      // so a fee or curve change after this point reverts it instead of costing the creator more.
      setStatus("Checking launch terms…");
      const fresh = await readLaunchTerms(publicClient);
      if (fresh.version !== shownTerms.version) {
        await terms.refetch();
        throw new Error("The launch terms just changed. Review the updated fee above and launch again.");
      }
      const firstBuy = safeParseEther(devBuy) ?? 0n;
      const minTokensOut =
        firstBuy > 0n ? (firstBuyTokens(firstBuy, shownTerms.feeBps, shownTerms.curve) * (10_000n - FIRST_BUY_SLIPPAGE_BPS)) / 10_000n : 0n;

      setStatus("Verifying X accounts…");
      const res = await fetch("/api/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creator: address, handles }),
      });
      const att = (await res.json()) as { error?: string; xIds: string[]; handles: string[]; deadline: string; attestation: Hex };
      if (!res.ok) throw new Error(att.error || "Could not verify X accounts");

      setStatus("Confirm in your wallet…");
      const hash = await writeContractAsync({
        address: LAUNCHPAD_ADDRESS,
        abi: launchpadAbi,
        chainId: activeChain.id,
        functionName: "createToken",
        args: [
          name.trim(),
          symbol.trim().toUpperCase(),
          metadata,
          { xIds: att.xIds.map(BigInt), handles: att.handles, bps, deadline: BigInt(att.deadline), attestation: att.attestation },
          minTokensOut,
          shownTerms.version,
        ],
        value: shownTerms.creationFee + firstBuy,
      });
      setStatus("Launching…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: launchpadAbi, ...log });
          if (ev.eventName === "TokenCreated") return router.push(`/token/${ev.args.token}?launched=1`);
        } catch {
          // not a launchpad event
        }
      }
      router.push("/");
    } catch (e) {
      setError(errorMessage(e));
      setStatus(null);
    } finally {
      inFlight.current = false;
    }
  }

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const previewSeed = address ?? "0x0000000000000000000000000000000000000000";

  // Everything below only draws the page.
  const firstBuyWei = safeParseEther(devBuy);
  const launch = useMemo(() => (shownTerms ? simulateLaunch(firstBuyWei ?? 0n, shownTerms) : undefined), [shownTerms, firstBuyWei]);
  const stepDone = (step: Issue["step"]) => !issues.some((p) => p.step === step);
  const ticker = (symbol || "TICKER").toUpperCase();
  const shares = bps.map((b) => (Number.isNaN(b) || b < 0 ? 0 : b));
  const shareLabels = handles.map((h, i) => (isValidHandle(h) ? `@${h}` : `Account ${i + 1}`));
  const previewHandles = Array.from(new Set(handles.filter(isValidHandle)));
  const creatorPct = feeBps !== undefined && protocolShareBps !== undefined ? (Number(feeBps) * (10_000 - Number(protocolShareBps))) / 1e6 : undefined;
  const stage = STAGES.findIndex(([s]) => s === status);
  const launchDisabled = Boolean(status) || paused === true || (isConnected && (problems.length > 0 || !shownTerms));

  return (
    <div className="space-y-8 pt-2 sm:space-y-10 sm:pt-4">
      {/* Header */}
      <div className="relative">
        <div aria-hidden className="bg-grid pointer-events-none absolute -inset-x-4 -top-8 -z-10 h-[360px] sm:-inset-x-6" />
        <div className="flex items-end justify-between gap-6">
          <div className="min-w-0">
            <Reveal>
              <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse-dot rounded-full bg-lime" aria-hidden />
                New coin · {activeChain.name}
              </span>
            </Reveal>
            <Reveal as="h1" delay={60} className="display mt-5 text-[44px] leading-[0.92] sm:text-[64px]">
              Launch a <span className="accent text-neon pr-1.5">coin</span>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-4 max-w-md text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">Every trade pays the X accounts you add below. Forever.</p>
            </Reveal>
          </div>
          <Reveal delay={180} className="relative isolate hidden shrink-0 sm:block">
            <div aria-hidden className="absolute inset-6 -z-10 rounded-full bg-lime opacity-[0.16] blur-2xl" />
            <StepLaunch className="h-36 w-36 animate-float md:h-44 md:w-44" />
          </Reveal>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-x-10 xl:grid-cols-[minmax(0,1fr)_384px]">
        {/* The form */}
        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          <Section n={1} title="Basics" hint="Name, ticker, picture and story." done={stepDone(1)}>
            <div className="space-y-5">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_9.5rem] sm:gap-x-5">
                <div className="col-start-1 row-span-2 row-start-1 self-center sm:row-span-1 sm:row-start-1 sm:self-end">
                  <button
                    type="button"
                    onClick={() => server?.uploads && fileRef.current?.click()}
                    className={`group relative block rounded-[27px] ${server?.uploads ? "cursor-pointer" : "cursor-default"}`}
                    aria-label="Coin image"
                  >
                    <TokenAvatar src={imageUrl} seed={previewSeed} size={96} className="transition duration-500 group-hover:-rotate-3 group-hover:scale-[1.03]" />
                    {server?.uploads ? (
                      <>
                        <span
                          className={`absolute inset-0 grid place-items-center rounded-[27px] bg-[var(--glass)] text-[12px] font-semibold text-ink backdrop-blur-[2px] transition ${
                            uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          {uploading ? "Uploading…" : "Upload"}
                        </span>
                        <span
                          aria-hidden
                          className="absolute -bottom-1.5 -right-1.5 grid h-8 w-8 place-items-center rounded-full border-[3px] border-card bg-lime text-[var(--lime-ink)] transition-transform duration-300 group-hover:scale-110"
                        >
                          {uploading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <PlusIcon />}
                        </span>
                      </>
                    ) : null}
                  </button>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                </div>
                <div className="col-start-2 row-start-1 min-w-0">
                  <label className="label" htmlFor="name">Name</label>
                  <input id="name" className="input" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Pon Coin" />
                </div>
                <div className="col-start-2 row-start-2 min-w-0 sm:col-start-3 sm:row-start-1">
                  <label className="label" htmlFor="ticker">Ticker</label>
                  <div className="relative">
                    <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-[15px] text-ink-3">
                      $
                    </span>
                    <input
                      id="ticker"
                      className="input pl-8 font-mono font-semibold uppercase"
                      maxLength={10}
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                      placeholder="PON"
                    />
                  </div>
                </div>
                <div className="col-span-full row-start-3 min-w-0 sm:row-start-2">
                  <label className="label" htmlFor="image">Image {server?.uploads ? "(upload by tapping the picture, or paste a link)" : "link"}</label>
                  <input id="image" className="input" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://… or ipfs://…  (empty = a generated sticker)" />
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <label className="label" htmlFor="desc">Description</label>
                  <span className="font-mono text-[11px] text-ink-3">{description.length}/500</span>
                </div>
                <textarea id="desc" className="input min-h-24 resize-y" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's the story?" />
              </div>
              {showLinks ? (
                <div className="grid animate-slide-up gap-3 sm:grid-cols-3">
                  <LinkInput icon={<GlobeIcon />} label="Website" value={website} onChange={setWebsite} placeholder="Website" />
                  <LinkInput icon={<SendIcon />} label="Telegram" value={telegram} onChange={setTelegram} placeholder="Telegram link" />
                  <LinkInput icon={<XMarkIcon />} label="X link" value={twitter} onChange={setTwitter} placeholder="X post or profile link" />
                </div>
              ) : (
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-dashed border-line-2 px-4 py-3 text-[14px] font-medium text-ink-2 transition hover:border-ink-3 hover:bg-card-2 hover:text-ink"
                  onClick={() => setShowLinks(true)}
                >
                  + Add links (website, Telegram, X)
                </button>
              )}
            </div>
          </Section>

          <Section n={2} title="Who gets the fees" hint={<>Up to {MAX_RECIPIENTS} X accounts. Locked in at launch.</>} done={stepDone(2)} delay={80}>
            <div aria-hidden className="mb-2.5 hidden grid-cols-[12px_minmax(0,1fr)_6rem_2.5rem] gap-x-3 sm:grid">
              <span />
              <span className="eyebrow pl-1">X account</span>
              <span className="eyebrow pr-3 text-right">Share</span>
              <span />
            </div>
            <ul className="space-y-3">
              {rows.map((r, i) => {
                const h = handles[i];
                const valid = isValidHandle(h);
                const prof = valid ? profiles.data?.[h] : undefined;
                const resolved = valid && profiles.data !== undefined && h in profiles.data;
                return (
                  <li
                    key={i}
                    className="grid animate-slide-up grid-cols-[12px_minmax(0,1fr)_5.5rem_2.5rem] items-start gap-x-2 sm:grid-cols-[12px_minmax(0,1fr)_6rem_2.5rem] sm:gap-x-3"
                    onFocus={() => setHot(i)}
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHot(null);
                    }}
                  >
                    <span
                      aria-hidden
                      className={`mt-[18px] h-3 w-3 rounded-full border border-outline transition-transform duration-300 ${hot === i ? "scale-125" : ""}`}
                      style={swatch(i)}
                    />
                    <div className="relative min-w-0">
                      <div className="relative">
                        <span className="pointer-events-none absolute left-2 top-1/2 flex -translate-y-1/2">
                          {valid ? <XAvatar handle={h} image={prof?.image} size={30} /> : <span className="h-[30px] w-[30px] rounded-full border border-dashed border-line-2" />}
                        </span>
                        <input
                          className={`input pl-12 ${valid ? "sm:pr-36" : ""}`}
                          value={r.handle}
                          onChange={(e) => update(i, { handle: e.target.value.replace(/^@+/, "") })}
                          placeholder="username"
                          aria-label={`X account ${i + 1}`}
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                      </div>
                      {prof ? (
                        <span className={`${HANDLE_STATUS} bg-up-soft text-up-ink`}>✓ {prof.name}</span>
                      ) : resolved ? (
                        <span className={`${HANDLE_STATUS} bg-down-soft text-down-ink`}>not found</span>
                      ) : valid && !profiles.error ? (
                        <span className={`${HANDLE_STATUS} text-ink-3`}>checking…</span>
                      ) : null}
                    </div>
                    <div className="relative">
                      <input
                        className="input num pl-2 pr-6 text-right sm:pl-3 sm:pr-7"
                        inputMode="decimal"
                        aria-label={`Share ${i + 1}`}
                        value={r.percent}
                        onChange={(e) => update(i, { percent: e.target.value })}
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[13px] text-ink-3 sm:right-3">%</span>
                    </div>
                    <button
                      type="button"
                      className="mt-1 grid h-10 w-10 place-items-center rounded-full text-[20px] leading-none text-ink-3 transition hover:bg-card-2 hover:text-down-ink disabled:opacity-30"
                      disabled={rows.length === 1}
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                      aria-label={`Remove account ${i + 1}`}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-5 border-t border-dashed border-line-2 pt-4">
              <div className="flex items-center gap-4">
                <SplitBar className="flex-1 lg:hidden" shares={shares} labels={shareLabels} hot={hot} />
                <div className="ml-auto shrink-0 text-right">
                  <div className="eyebrow">Total</div>
                  <div className={`num mt-1 text-[15px] font-semibold ${totalBps === BPS ? "text-up-ink" : "text-down-ink"}`}>{pct(totalBps)} / 100%</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary h-10 px-4 text-[14px]"
                  disabled={rows.length >= MAX_RECIPIENTS}
                  onClick={() => setRows((rs) => [...rs, { handle: "", percent: "0" }])}
                >
                  + Add account
                </button>
                <button
                  type="button"
                  className="btn h-10 px-4 text-[14px] font-medium text-ink-2 hover:bg-card-2 hover:text-ink"
                  onClick={() => setRows((rs) => evenSplit(rs.length).map((p, i) => ({ ...rs[i], percent: p })))}
                >
                  <DivideIcon />
                  Split evenly
                </button>
                <span className="ml-auto font-mono text-[11px] text-ink-3">
                  {rows.length}/{MAX_RECIPIENTS}
                </span>
              </div>
              {profiles.error ? (
                <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
                  Profile lookup is unavailable right now ({(profiles.error as Error).message}); accounts are verified when you launch.
                </p>
              ) : null}
            </div>
          </Section>

          <Section
            n={3}
            done={stepDone(3) && (firstBuyWei ?? 0n) > 0n}
            delay={160}
            title={
              <label htmlFor="devbuy" className="cursor-pointer">
                Be the first buyer{" "}
                <span className="whitespace-nowrap align-middle font-sans text-[14px] font-medium tracking-normal text-ink-3 [font-variation-settings:normal]">(optional)</span>
              </label>
            }
          >
            <div className="relative">
              <input
                id="devbuy"
                className="input num h-14 pr-16 text-[20px] sm:text-[22px]"
                inputMode="decimal"
                placeholder="0"
                value={devBuy}
                onChange={(e) => setDevBuy(e.target.value.replace(",", "."))}
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-[13px] font-semibold text-ink-2">ETH</span>
            </div>
            {launch && firstBuyWei !== undefined && firstBuyWei > 0n ? (
              <div className="mt-3 animate-slide-up rounded-2xl border border-line bg-card-2 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="eyebrow">You get about</span>
                  <span className="num text-[15px] font-semibold">
                    <Flash value={launch.tokens}>
                      {compact(Number(formatUnits(launch.tokens, 18)))} ${ticker}
                    </Flash>
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-3">
                  {launch.soldOut
                    ? "The whole curve: the coin graduates to PonSwap at launch and the rest of your ETH is refunded."
                    : `${launch.supplyShare.toLocaleString("en-US", { maximumFractionDigits: 2 })}% of the supply`}
                </p>
              </div>
            ) : null}
            <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
              Bought in the same transaction as the launch, so nobody gets in before you.
              {creationFee === undefined ? "" : creationFee > 0n ? ` Launch fee ${formatEther(creationFee)} ETH, paid on top.` : " Launching is free."}
            </p>
            {terms.isError && !shownTerms ? (
              <p className="mt-2 text-[12px] font-medium text-down-ink">Can&apos;t read the launch terms from {activeChain.name} right now. Retrying…</p>
            ) : null}
          </Section>
        </div>

        {/* Live preview: beside the form on desktop, between the form and the launch button on phones. */}
        <Reveal as="aside" delay={120} className="relative isolate min-w-0 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-10 -z-10 h-72 rounded-full bg-lime opacity-[0.07] blur-3xl" />
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <span className="eyebrow inline-flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-lime" />
              Live preview
            </span>
            <span className="font-mono text-[11px] text-ink-3">as it shows on Explore</span>
          </div>

          {/* The coin card, drawn like TokenCard with what's typed so far. */}
          <div className="card ring-glow group relative flex flex-col gap-3 p-4">
            <div className="flex gap-3.5">
              <TokenAvatar src={imageUrl} seed={previewSeed} size={72} className="transition duration-500 group-hover:-rotate-3 group-hover:scale-105" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className={`truncate text-[16px] font-semibold ${name.trim() ? "" : "text-ink-3"}`}>{name.trim() || "Your coin"}</span>
                  <span className="shrink-0 font-mono text-[12px] text-ink-2">${ticker}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
                  <span>{address ? shortAddress(address) : "you"}</span>
                  <span>·</span>
                  <span>just now</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-ink-2 [overflow-wrap:anywhere]">{description.trim() || "Your description shows up here."}</p>
              </div>
            </div>
            <div className="mt-auto flex items-center gap-2">
              {previewHandles.length ? (
                <XAvatarStack handles={previewHandles} size={20} max={3} />
              ) : (
                <span aria-hidden className="h-5 w-5 rounded-full border border-dashed border-line-2" />
              )}
              <span className="ml-auto font-mono text-[11px] text-ink-3">
                mcap{" "}
                <span className="text-[13px] font-semibold text-ink">
                  <Flash value={launch?.marketCap}>{launch ? `${compact(launch.marketCap)} Ξ` : "–"}</Flash>
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Progress value={launch?.progress ?? 0} graduated={launch?.soldOut} size="sm" />
              </div>
              <span className={`num text-[11px] font-semibold ${launch?.soldOut ? "text-up-ink" : "text-ink-2"}`}>
                {launch?.soldOut ? "PonSwap" : `${progressText(launch?.progress ?? 0)}%`}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-line pt-2.5 font-mono text-[11px] text-ink-3">
              <span>split so far</span>
              <span className="text-up-ink">{formatEth(launch?.split ?? 0n, 4)} ETH</span>
            </div>
          </div>

          {/* The split, in the account colors. */}
          <div className="card mt-3 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="eyebrow">Fee split</span>
              {creatorPct !== undefined ? (
                <span className="font-mono text-[11px] text-ink-3">{creatorPct.toLocaleString("en-US", { maximumFractionDigits: 2 })}% of every trade</span>
              ) : null}
            </div>
            <SplitBar className="mt-3" shares={shares} labels={shareLabels} hot={hot} onHot={setHot} />
            <ul className="-mx-2 mt-2">
              {rows.map((_, i) => {
                const h = handles[i];
                const valid = isValidHandle(h);
                const prof = valid ? profiles.data?.[h] : undefined;
                return (
                  <li
                    key={i}
                    onMouseEnter={() => setHot(i)}
                    onMouseLeave={() => setHot(null)}
                    className={`flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-200 ${hot === i ? "bg-card-2" : ""}`}
                  >
                    {/* The ring is the account's color in the bar. XAvatar draws a 2px card-colored
                        ring of its own, so 4px of padding leaves 2px of color showing around it. */}
                    <span aria-hidden className="flex shrink-0 rounded-full p-1" style={swatch(i)}>
                      {valid ? <XAvatar handle={h} image={prof?.image} size={24} /> : <span className="h-6 w-6 rounded-full bg-card ring-2 ring-card" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {valid ? (
                        <>
                          <span className="font-semibold">@{h}</span>
                          {prof && prof.name.toLowerCase() !== h ? <span className="text-ink-3"> · {prof.name}</span> : null}
                        </>
                      ) : (
                        <span className="text-ink-3">Account {i + 1}</span>
                      )}
                    </span>
                    <span className="num shrink-0 rounded-full px-2 py-1 text-[12px] font-bold leading-none text-[var(--lime-ink)]" style={{ backgroundColor: colorOf(i) }}>
                      {Number.isNaN(bps[i]) ? "–" : pct(bps[i])}
                    </span>
                  </li>
                );
              })}
            </ul>
            {!handles.some(isValidHandle) ? <p className="mt-2 text-[12px] text-ink-3">Add X accounts to see the split.</p> : null}
          </div>
          <p className="mt-3 px-1 text-[11px] leading-relaxed text-ink-3">Fees follow each account&apos;s permanent X id, so a rename never moves them.</p>
        </Reveal>

        {/* Launch */}
        <Reveal delay={80} className="min-w-0 lg:col-start-1 lg:row-start-2">
          <div className="card relative isolate overflow-hidden p-5 sm:p-7">
            <div aria-hidden className="bg-grid absolute inset-0 -z-10 opacity-70" />
            <div aria-hidden className="absolute -bottom-32 left-1/2 -z-10 h-56 w-3/4 -translate-x-1/2 rounded-full bg-lime opacity-[0.1] blur-3xl" />

            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-card-2 text-ink-2">
                  <LockIcon />
                </span>
                <div className="min-w-0">
                  <div className="eyebrow">Launch</div>
                  {feeBps !== undefined && protocolShareBps !== undefined ? (
                    <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">
                      Terms locked in at launch: {Number(feeBps) / 100}% fee on every trade, of which{" "}
                      <b className="font-semibold text-ink">{(10_000 - Number(protocolShareBps)) / 100}% goes to your X accounts</b>.
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[14px] text-ink-3">Reading the launch terms from {activeChain.name}…</p>
                  )}
                </div>
              </div>

              {shownTerms ? (
                <dl className="space-y-2 border-t border-dashed border-line-2 pt-4 font-mono text-[12px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-3">Launch fee</dt>
                    <dd className="text-ink">{shownTerms.creationFee > 0n ? `${formatEther(shownTerms.creationFee)} ETH` : "free"}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-3">First buy</dt>
                    <dd className="text-ink">{firstBuyWei === undefined ? "–" : `${formatEther(firstBuyWei)} ETH`}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
                    <dt className="text-ink-2">You pay</dt>
                    <dd className="text-right">
                      <span className="text-[14px] font-semibold text-ink">
                        <Flash value={firstBuyWei === undefined ? undefined : shownTerms.creationFee + firstBuyWei}>
                          {firstBuyWei === undefined ? "–" : `${formatEther(shownTerms.creationFee + firstBuyWei)} ETH`}
                        </Flash>
                      </span>{" "}
                      <span className="text-ink-3">+ gas</span>
                    </dd>
                  </div>
                </dl>
              ) : null}

              {problems.length > 0 && touched ? (
                <div className="rounded-2xl border border-line bg-card-2 p-4">
                  <div className="eyebrow">Before you can launch</div>
                  <ul className="mt-2.5 space-y-1.5 text-[13px] leading-snug text-ink-2">
                    {problems.map((p, k) => (
                      <li key={`${k}-${p}`} className="flex gap-2.5">
                        <span aria-hidden className="mt-[5px] h-2 w-2 shrink-0 rounded-full border-2 border-down" />
                        <span className="min-w-0 [overflow-wrap:anywhere]">{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {error ? (
                <p role="alert" className="flex items-start gap-2.5 rounded-2xl bg-down-soft px-4 py-3 text-[14px] font-medium text-down-ink">
                  <AlertIcon />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
                </p>
              ) : null}
              {server && !server.signer ? (
                <p className="flex items-start gap-2.5 rounded-2xl bg-down-soft px-4 py-3 text-[13px] text-down-ink">
                  <AlertIcon />
                  <span>This server has no signer configured, so launches are disabled.</span>
                </p>
              ) : null}
              {paused ? (
                <p className="flex items-start gap-2.5 rounded-2xl bg-down-soft px-4 py-3 text-[14px] font-medium text-down-ink">
                  <PauseIcon />
                  <span>New launches are paused by the owner for now.</span>
                </p>
              ) : null}

              <button className="btn-neon group/cta w-full py-4 text-[17px] sm:py-[18px] sm:text-[18px]" disabled={launchDisabled} onClick={() => guard(submit)}>
                {status ? <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
                {!isConnected ? "Connect wallet to launch" : status ?? (shownTerms ? "Launch coin" : "Reading launch terms…")}
                {!launchDisabled ? (
                  <span aria-hidden className="transition-transform duration-300 group-hover/cta:translate-x-1">
                    →
                  </span>
                ) : null}
              </button>

              {status ? (
                <ol aria-hidden className="grid grid-cols-4 gap-2">
                  {STAGES.map(([, label], k) => (
                    <li key={label} className="min-w-0">
                      <span className={`block h-1 rounded-full transition-colors duration-500 ${k < stage ? "bg-lime" : k === stage ? "animate-pulse bg-lime" : "bg-card-3"}`} />
                      <span className={`mt-1.5 block truncate font-mono text-[10px] uppercase tracking-[0.1em] ${k <= stage ? "text-ink" : "text-ink-3"}`}>{label}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          </div>
        </Reveal>
      </div>
      {dialog}
    </div>
  );
}

/**
 * One numbered step of the form. The big number is an outline while the step still needs work and
 * gets stamped in neon once it's done.
 */
function Section({ n, title, hint, done, delay = 0, children }: { n: 1 | 2 | 3; title: ReactNode; hint?: ReactNode; done: boolean; delay?: number; children: ReactNode }) {
  return (
    <Reveal as="section" delay={delay} className="card relative isolate p-5 sm:p-7">
      <span
        key={done ? "done" : "todo"}
        aria-hidden
        className={`display pointer-events-none absolute right-5 top-4 -z-10 select-none text-[64px] leading-none tracking-normal sm:right-7 sm:top-5 sm:text-[88px] ${
          done ? "text-neon animate-stamp" : "text-transparent"
        }`}
        style={done ? undefined : { WebkitTextStroke: "1px var(--line-2)" }}
      >
        0{n}
      </span>
      <div className="pr-20 sm:pr-28">
        <div className="eyebrow">
          Step {n} of 3{done ? <span className="text-up-ink"> · done</span> : null}
        </div>
        <h2 className="display mt-2 text-[26px] leading-[1.02] sm:text-[32px]">{title}</h2>
        {hint ? <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{hint}</p> : null}
      </div>
      <div className="mt-6">{children}</div>
    </Reveal>
  );
}

/**
 * The split as one stacked bar in the account colors, drawn like the coin page's: pill slices on a
 * track, gaps between them. A share not handed out yet leaves the track empty; over 100% the slices
 * shrink to fit (the total next to it says why).
 */
function SplitBar({
  shares,
  labels,
  hot,
  onHot,
  className = "",
}: {
  shares: number[];
  labels: string[];
  hot: number | null;
  onHot?: (i: number | null) => void;
  className?: string;
}) {
  const rest = Math.max(0, BPS - shares.reduce((a, b) => a + b, 0));
  return (
    <div aria-hidden className={`flex h-4 w-full gap-[3px] overflow-hidden rounded-full bg-card-3 p-[3px] ${className}`}>
      {shares.map((s, i) =>
        s > 0 ? (
          <span
            key={i}
            title={`${labels[i]} · ${pct(s)}`}
            onMouseEnter={onHot && (() => onHot(i))}
            onMouseLeave={onHot && (() => onHot(null))}
            className="h-full min-w-[3px] rounded-full transition-[flex-grow,opacity] duration-500 ease-out"
            style={{ ...swatch(i), flex: `${s} 1 0%`, opacity: hot === null || hot === i ? 1 : 0.3 }}
          />
        ) : null
      )}
      {rest > 0 ? <span className="h-full transition-[flex-grow] duration-500 ease-out" style={{ flex: `${rest} 1 0%` }} /> : null}
    </div>
  );
}

function LinkInput({ icon, label, value, onChange, placeholder }: { icon: ReactNode; label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-0">
      <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 flex -translate-y-1/2 text-ink-3">
        {icon}
      </span>
      <input className="input pl-10" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

const ICON = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function PlusIcon() {
  return (
    <svg {...ICON} strokeWidth={2.6}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg {...ICON}>
      <path d="M21 3 10.5 13.5" />
      <path d="M21 3 14.5 21l-4-7.5L3 9.5z" />
    </svg>
  );
}

function XMarkIcon() {
  return (
    <svg {...ICON}>
      <path d="M4.5 4h4L19.5 20h-4z" />
      <path d="M19.5 4 13.4 10.9M4.5 20l6.1-6.9" />
    </svg>
  );
}

function DivideIcon() {
  return (
    <svg {...ICON}>
      <path d="M5 12h14" />
      <circle cx="12" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="17.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg {...ICON}>
      <rect x="5" y="11" width="14" height="9" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg {...ICON} className="mt-0.5 shrink-0">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg {...ICON} className="mt-0.5 shrink-0">
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9v6M14 9v6" />
    </svg>
  );
}
