"use client";

import { shrinkImage } from "@/lib/shrink-image";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Keypair, PublicKey, type VersionedTransaction } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { GithubAvatar, GithubAvatarStack } from "@/components/GithubAvatar";
import { Progress } from "@/components/Progress";
import { useRiskGate } from "@/components/RiskNotice";
import { TokenAvatar } from "@/components/TokenAvatar";
import { StepLaunch } from "@/components/art";
import { Flash, Reveal } from "@/components/motion";
import { compact, errorMessage, formatSol, pct, progressText, shortAddress } from "@/lib/format";
import { isValidLogin, normalizeLogin } from "@/lib/github-handles";
import { useDebounced, useGithubProfiles, useSolBalance } from "@/lib/hooks";
import { safeUrl } from "@/lib/metadata";
import { LAUNCH_FEE_LAMPORTS, MAX_RECIPIENTS, PLATFORM_BPS, SHARES_TOTAL, isLive } from "@/lib/solana/config";
import { createTransaction, finishLaunchTransactions, firstBuyTokens, launchState, newCurvePreview } from "@/lib/solana/pump";

type Row = { handle: string; percent: string };

/** "12.5" or "12,5" (comma keypads, e.g. an iPhone set to Turkey) → basis points; NaN if invalid. */
function toBps(percent: string): number {
  const v = percent.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(v)) return NaN;
  return Math.round(parseFloat(v) * 100);
}

/** pump.fun's limits: name 32 characters, ticker 13 (we keep it to 10), metadata link 200. */
const MAX_NAME = 32;
const MAX_TICKER = 10;
const MAX_DESCRIPTION = 500;
/** Rough SOL a launch needs beyond the fee and the first buy: account rent and network fees. */
const LAUNCH_RENT_LAMPORTS = 40_000_000n;

/** SOL text → lamports; undefined if it isn't a non-negative number with at most 9 decimals. */
function parseSol(v: string): bigint | undefined {
  const t = v.trim();
  if (!t) return 0n;
  if (!/^\d*\.?\d{0,9}$/.test(t) || t === ".") return undefined;
  const [i, f = ""] = t.split(".");
  return BigInt(i || "0") * 1_000_000_000n + BigInt((f + "000000000").slice(0, 9));
}

function evenSplit(n: number): string[] {
  const base = Math.floor(SHARES_TOTAL / n);
  return Array.from({ length: n }, (_, i) => ((i === 0 ? base + (SHARES_TOTAL - base * n) : base) / 100).toString());
}

/**
 * The account colors, in split order, exactly as the coin page's fee split draws them: accounts
 * past the fifth reuse the five hues, striped, so no two accounts in one split look alike.
 */
const ACCOUNT_COLORS = ["var(--sky)", "var(--pink)", "var(--sun)", "var(--lilac)", "var(--orange)"];
const STRIPES = "repeating-linear-gradient(135deg, transparent 0 3px, rgba(11, 11, 13, 0.3) 3px 5px)";
const colorOf = (i: number) => ACCOUNT_COLORS[i % ACCOUNT_COLORS.length];
const swatch = (i: number): CSSProperties => ({ backgroundColor: colorOf(i), backgroundImage: i >= ACCOUNT_COLORS.length ? STRIPES : undefined });

/** The steps `submit` reports while launching, in order, with short labels for the progress rail. */
const STAGES = [
  ["Saving the coin's details…", "Details"],
  ["Confirm in your wallet…", "Wallet"],
  ["Creating the coin…", "Coin"],
  ["Locking the fee split…", "Split"],
] as const;

/** Why the launch button is disabled, and which form section (1-3) the fix belongs to. */
type Issue = { step: 1 | 2 | 3; text: string };

/** Status pill beside a username: under the field on phones, inside it from `sm` up. */
const HANDLE_STATUS =
  "pointer-events-none mt-1.5 block w-fit max-w-full truncate rounded-full px-2 py-0.5 text-[12px] font-medium sm:absolute sm:right-2.5 sm:top-1/2 sm:mt-0 sm:max-w-[8rem] sm:-translate-y-1/2";

/**
 * A launch that was signed but may not have finished: its coin could exist without its split. Kept
 * per wallet (several per wallet) from the moment the wallet signs, and checked against the chain
 * before the page offers to finish it.
 */
type Pending = { mint: string; symbol: string; githubIds: string[]; bps: number[]; at: number };
const PENDING_KEY = "splidev:pending-launch:v2";
function readAll(): Record<string, Pending[]> {
  try {
    const all = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}") as Record<string, Pending[]>;
    return all && typeof all === "object" ? all : {};
  } catch {
    return {};
  }
}
function readPending(wallet: string): Pending[] {
  const list = readAll()[wallet];
  return Array.isArray(list) ? list : [];
}
function savePending(wallet: string, p: Pending) {
  try {
    const all = readAll();
    all[wallet] = [...readPending(wallet).filter((x) => x.mint !== p.mint), p];
    localStorage.setItem(PENDING_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: an interrupted launch can't be resumed from this browser
  }
}
function dropPending(wallet: string, mint: string) {
  try {
    const all = readAll();
    all[wallet] = readPending(wallet).filter((x) => x.mint !== mint);
    if (!all[wallet].length) delete all[wallet];
    localStorage.setItem(PENDING_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable
  }
}

export default function CreatePage() {
  const live = isLive();
  const router = useRouter();
  const { connection } = useConnection();
  const { publicKey, connected, signAllTransactions } = useWallet();
  const { setVisible } = useWalletModal();
  const address = publicKey?.toBase58();
  const sol = useSolBalance();
  const { guard, dialog } = useRiskGate();
  // pump.fun's live terms for the first-buy preview.
  const terms = useQuery({
    queryKey: ["pump-terms"],
    staleTime: 60_000,
    queryFn: async () => {
      const sdk = new OnlinePumpSdk(connection);
      const [global, feeConfig] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig().catch(() => null)]);
      return { global, feeConfig };
    },
  });

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
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // The account being edited or pointed at, so its slice of the split lights up in the preview.
  const [hot, setHot] = useState<number | null>(null);
  const [pendingTick, setPendingTick] = useState(0);
  const stored = useMemo(() => (address ? readPending(address) : []), [address, pendingTick]); // eslint-disable-line react-hooks/exhaustive-deps
  // What the chain says about each stored launch: finished ones and ones whose coin never landed
  // are forgotten; only a coin that exists without its final split is offered for finishing.
  const pendingState = useQuery({
    queryKey: ["pending-launches", address, stored.map((p) => p.mint).join(",")],
    enabled: Boolean(address && stored.length),
    queryFn: async () => {
      const open: Pending[] = [];
      for (const p of stored) {
        const state = await launchState(connection, new PublicKey(p.mint));
        if (state === "done" || (state === "missing" && Date.now() - p.at > 3 * 60_000)) dropPending(address!, p.mint);
        else if (state === "needs-split") open.push(p);
      }
      return open;
    },
  });
  const pending = pendingState.data?.[0] ?? null;

  const handles = useMemo(() => rows.map((r) => normalizeLogin(r.handle)), [rows]);
  const bps = useMemo(() => rows.map((r) => toBps(r.percent)), [rows]);
  const totalBps = bps.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0);

  // Debounce a string, not an array: a fresh array every render would re-arm the timer forever.
  const lookupKey = useDebounced(handles.filter(isValidLogin).join(","));
  const lookup = useMemo(() => (lookupKey ? lookupKey.split(",") : []), [lookupKey]);
  const profiles = useGithubProfiles(lookup);
  const inFlight = useRef(false);

  const imageUrl = image.trim() ? safeUrl(image.trim()) : undefined;
  const firstBuy = parseSol(devBuy);

  const issues = useMemo(() => {
    const p: Issue[] = [];
    const add = (step: Issue["step"], text: string) => p.push({ step, text });
    if (!name.trim()) add(1, "Give your coin a name.");
    else if (name.trim().length > MAX_NAME) add(1, `The name is too long (${MAX_NAME} characters max).`);
    if (!symbol.trim() || symbol.trim().length > MAX_TICKER) add(1, `Add a ticker (up to ${MAX_TICKER} letters or digits).`);
    if (description.length > MAX_DESCRIPTION) add(1, `Keep the description under ${MAX_DESCRIPTION} characters.`);
    if (image.trim() && !imageUrl) add(1, "Image must be an https:// or ipfs:// link.");
    for (const [label, v] of [["Website", website], ["Telegram", telegram], ["X link", twitter]] as const) {
      if (v.trim() && !safeUrl(v.trim())) add(1, `${label} must be an https:// link.`);
      else if (v.trim().length > 200) add(1, `${label} link is too long (200 characters max).`);
    }
    handles.forEach((h, i) => {
      const prof = profiles.data?.[h];
      if (!isValidLogin(h)) add(2, `Account ${i + 1}: enter a GitHub username.`);
      else if (profiles.data && h in profiles.data && prof === null) add(2, `Couldn't find ${h} on GitHub. Check the spelling.`);
      else if (prof?.type === "Organization") add(2, `${h} is a GitHub organization; only personal accounts can sign in to claim.`);
    });
    if (new Set(handles).size !== handles.length) add(2, "Each GitHub account can only appear once.");
    const ids = handles.map((h) => profiles.data?.[h]?.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) add(2, "Two usernames point to the same GitHub account.");
    // After Splitdev's cut each share must still be at least one basis point of the creator fee.
    if (bps.some((b) => Number.isNaN(b) || b <= 0)) add(2, "Every share must be above 0% (2 decimals max).");
    else if (bps.some((b) => Math.floor((b * (SHARES_TOTAL - PLATFORM_BPS)) / SHARES_TOTAL) < 1)) add(2, "Every share must be at least 0.02%.");
    else if (totalBps !== SHARES_TOTAL) add(2, `Shares add up to ${pct(totalBps)}; they need to total 100%.`);
    if (firstBuy === undefined) add(3, "First buy must be a SOL amount.");
    return p;
  }, [name, symbol, description, image, imageUrl, website, telegram, twitter, handles, bps, totalBps, firstBuy, profiles.data]);
  const problems = useMemo(() => issues.map((p) => p.text), [issues]);

  const touched = Boolean(name || symbol || handles.some(Boolean));

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", await shrinkImage(file));
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

  /**
   * Signs every transaction at once (one wallet prompt), then sends them in order. `onSigned` runs
   * as soon as the wallet signed, before anything is sent, so an interrupted launch is always on record.
   */
  async function signAndSend(txs: VersionedTransaction[], onSigned?: () => void, afterFirst?: () => void) {
    if (!signAllTransactions) throw new Error("This wallet can't sign several transactions at once. Try Phantom, Solflare or Backpack.");
    setStatus("Confirm in your wallet…");
    const signed = await signAllTransactions(txs);
    onSigned?.();
    for (const [i, tx] of signed.entries()) {
      const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 }).catch((e: { logs?: string[] }) => {
        // The program logs are what explain a rejected launch; keep them in the console.
        console.error(`Launch transaction ${i + 1} of ${signed.length} was rejected`, e, e?.logs?.join("\n") ?? "");
        throw e;
      });
      await confirmed(sig, i === 0 ? "Creating the coin failed on chain." : "Setting the fee split failed on chain.");
      if (i === 0) afterFirst?.();
    }
  }

  /**
   * Waits for a signature by polling its status (up to ~75 s, past a blockhash's lifetime): a dropped
   * websocket or one failed request doesn't turn a landed transaction into an error.
   */
  async function confirmed(sig: string, failure: string) {
    for (let k = 0; k < 50; k++) {
      const st = (await connection.getSignatureStatuses([sig]).catch(() => null))?.value[0];
      if (st?.err) throw new Error(failure);
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
      await new Promise((r) => setTimeout(r, 1_500));
    }
    throw new Error("The network was slow to confirm. Reload this page in a minute: an unfinished launch shows up here to finish.");
  }

  async function submit() {
    setError(null);
    if (!connected || !publicKey || !address) return setVisible(true);
    if (!live || problems.length || inFlight.current || firstBuy === undefined) return;
    const githubIds = handles.map((h) => profiles.data?.[h]?.id);
    if (githubIds.some((id) => !id)) return setError("Still checking the GitHub accounts. Try again in a moment.");
    inFlight.current = true;
    try {
      setStatus(STAGES[0][0]);
      const res = await fetch("/api/metadata", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), symbol: symbol.trim().toUpperCase(), description: description.trim(), image: image.trim(), website: website.trim(), twitter: twitter.trim(), telegram: telegram.trim() }),
      });
      const meta = (await res.json()) as { uri?: string; error?: string };
      if (!res.ok || !meta.uri) throw new Error(meta.error || "Couldn't save the coin's details.");

      const mint = Keypair.generate();
      const input = {
        user: publicKey,
        mint: mint.publicKey,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        uri: meta.uri,
        githubIds: githubIds as string[],
        bps,
        firstBuyLamports: firstBuy,
      };
      const create = await createTransaction(connection, input);
      create.sign([mint]);
      const finish = await finishLaunchTransactions(connection, publicKey, mint.publicKey, input.githubIds, bps);
      const record: Pending = { mint: mint.publicKey.toBase58(), symbol: input.symbol, githubIds: input.githubIds, bps, at: Date.now() };
      await signAndSend(
        [create, ...finish],
        // Signed: from here the coin may land, so remember the launch until its split is confirmed.
        () => savePending(address, record),
        () => setStatus(STAGES[3][0])
      );
      dropPending(address, record.mint);
      router.push(`/token/${mint.publicKey.toBase58()}?launched=1`);
    } catch (e) {
      setError(errorMessage(e));
      setStatus(null);
      setPendingTick((t) => t + 1);
    } finally {
      inFlight.current = false;
    }
  }

  /** Sets the fee split of a coin whose launch stopped after it was created. */
  async function finishPending() {
    if (!publicKey || !address || !pending || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      const mint = new PublicKey(pending.mint);
      const txs = await finishLaunchTransactions(connection, publicKey, mint, pending.githubIds, pending.bps);
      if (txs.length) await signAndSend(txs);
      dropPending(address, pending.mint);
      router.push(`/token/${pending.mint}?launched=1`);
    } catch (e) {
      setError(errorMessage(e));
      setStatus(null);
      setPendingTick((t) => t + 1);
    } finally {
      inFlight.current = false;
    }
  }

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const previewSeed = address ?? "11111111111111111111111111111111";

  // Everything below only draws the page.
  const launch = useMemo(() => {
    if (!terms.data) return undefined;
    const tokens = firstBuy && firstBuy > 0n ? firstBuyTokens(terms.data.global, terms.data.feeConfig, firstBuy) : 0n;
    return { tokens, ...newCurvePreview(terms.data.global, tokens) };
  }, [terms.data, firstBuy]);
  const stepDone = (step: Issue["step"]) => !issues.some((p) => p.step === step);
  const ticker = (symbol || "TICKER").toUpperCase();
  const shares = bps.map((b) => (Number.isNaN(b) || b < 0 ? 0 : b));
  const shareLabels = handles.map((h, i) => (isValidLogin(h) ? `@${h}` : `Account ${i + 1}`));
  const previewPeople = Array.from(new Set(handles.filter(isValidLogin))).map((h) => ({ githubId: profiles.data?.[h]?.id ?? h, login: h }));
  const accountsPct = (SHARES_TOTAL - PLATFORM_BPS) / 100;
  const stage = STAGES.findIndex(([s]) => s === status);
  const total = (firstBuy ?? 0n) + LAUNCH_FEE_LAMPORTS;
  const short = connected && sol.data !== undefined && sol.data < total + LAUNCH_RENT_LAMPORTS;
  const launchDisabled = Boolean(status) || !live || (connected && (problems.length > 0 || short));

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
                New coin · Solana
              </span>
            </Reveal>
            <Reveal as="h1" delay={60} className="display mt-5 text-[44px] leading-[0.92] sm:text-[64px]">
              Launch a <span className="accent text-neon pr-1.5">coin</span>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-4 max-w-md text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">
                Minted on pump.fun. Every trade pays the GitHub developers you add below. Forever.
              </p>
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
                    onClick={() => true && fileRef.current?.click()}
                    className={`group relative block rounded-[27px] ${true ? "cursor-pointer" : "cursor-default"}`}
                    aria-label="Coin image"
                  >
                    <TokenAvatar src={imageUrl} seed={previewSeed} size={96} className="transition duration-500 group-hover:-rotate-3 group-hover:scale-[1.03]" />
                    {true ? (
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
                  <input id="name" className="input" maxLength={MAX_NAME} value={name} onChange={(e) => setName(e.target.value)} placeholder="Dev Coin" />
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
                      placeholder="DEV"
                    />
                  </div>
                </div>
                <div className="col-span-full row-start-3 min-w-0 sm:row-start-2">
                  {true ? (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragging(false);
                        const f = e.dataTransfer.files?.[0];
                        if (f) upload(f);
                      }}
                      className={`flex flex-wrap items-center gap-3 rounded-2xl border border-dashed p-3 transition ${dragging ? "border-lime bg-lime-soft" : "border-line-2 bg-card-2"}`}
                    >
                      <button type="button" className="btn-secondary px-4 py-2 text-[14px]" disabled={uploading} onClick={() => fileRef.current?.click()}>
                        {uploading ? "Uploading…" : image ? "Change image" : "Choose image from files"}
                      </button>
                      <span className="text-[12.5px] text-ink-3">PNG, JPG, WEBP or GIF. Big photos are shrunk for you. Or drop it here.</span>
                      <details className="w-full text-[12.5px] text-ink-2" open={Boolean(image) && !/^https:\/\/[^/]+\.blob\.vercel-storage\.com\/|^ipfs:\/\//.test(image)}>
                        <summary className="cursor-pointer select-none">Or paste a link</summary>
                        <input id="image" className="input mt-2" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://… or ipfs://…" />
                      </details>
                    </div>
                  ) : (
                    <>
                      <label className="label" htmlFor="image">Image link</label>
                      <input id="image" className="input" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://… or ipfs://…  (empty = a generated sticker)" />
                    </>
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <label className="label" htmlFor="desc">Description</label>
                  <span className="font-mono text-[11px] text-ink-3">
                    {description.length}/{MAX_DESCRIPTION}
                  </span>
                </div>
                <textarea
                  id="desc"
                  className="input min-h-24 resize-y"
                  maxLength={MAX_DESCRIPTION}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What's the story?"
                />
              </div>
              {showLinks ? (
                <div className="grid animate-slide-up gap-3 sm:grid-cols-2">
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

          <Section n={2} title="Who gets the fees" hint={<>Up to {MAX_RECIPIENTS} GitHub accounts. Locked in for good at launch.</>} done={stepDone(2)} delay={80}>
            <div aria-hidden className="mb-2.5 hidden grid-cols-[12px_minmax(0,1fr)_6rem_2.5rem] gap-x-3 sm:grid">
              <span />
              <span className="eyebrow pl-1">GitHub user</span>
              <span className="eyebrow pr-3 text-right">Share</span>
              <span />
            </div>
            <ul className="space-y-3">
              {rows.map((r, i) => {
                const h = handles[i];
                const valid = isValidLogin(h);
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
                          {valid ? <GithubAvatar id={prof?.id} login={h} size={30} /> : <span className="h-[30px] w-[30px] rounded-full border border-dashed border-line-2" />}
                        </span>
                        <input
                          className={`input pl-12 ${valid ? "sm:pr-36" : ""}`}
                          value={r.handle}
                          onChange={(e) => update(i, { handle: e.target.value.replace(/^@+/, "") })}
                          placeholder="github username"
                          aria-label={`GitHub account ${i + 1}`}
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
                  <div className={`num mt-1 text-[15px] font-semibold ${totalBps === SHARES_TOTAL ? "text-up-ink" : "text-down-ink"}`}>{pct(totalBps)} / 100%</div>
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
                  GitHub lookup is unavailable right now ({(profiles.error as Error).message}). Try again in a minute.
                </p>
              ) : null}
            </div>
          </Section>

          <Section n={3} done={stepDone(3)} delay={160} title="First buy" hint="Optional. Leave it at 0 for a plain launch.">
            <div>
              <label htmlFor="devbuy" className="label">
                Be the first buyer
              </label>
              <div className="relative">
                <input
                  id="devbuy"
                  className="input num h-14 pr-16 text-[20px] sm:text-[22px]"
                  inputMode="decimal"
                  placeholder="0"
                  value={devBuy}
                  onChange={(e) => setDevBuy(e.target.value.replace(",", "."))}
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-[13px] font-semibold text-ink-2">SOL</span>
              </div>
              {launch && firstBuy !== undefined && firstBuy > 0n ? (
                <div className="mt-3 animate-slide-up rounded-2xl border border-line bg-card-2 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="eyebrow">You get about</span>
                    <span className="num text-[15px] font-semibold">
                      <Flash value={Number(launch.tokens)}>
                        {compact(Number(launch.tokens) / 1e6)} ${ticker}
                      </Flash>
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-3">
                    {launch.supplyShare.toLocaleString("en-US", { maximumFractionDigits: 2 })}% of the supply
                  </p>
                </div>
              ) : null}
              <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
                Bought in the same transaction that creates the coin, so nobody gets in before you. pump.fun&apos;s usual trading fee applies.
              </p>
            </div>
            {terms.isError && !terms.data ? <p className="mt-2 text-[12px] font-medium text-down-ink">Can&apos;t read pump.fun&apos;s terms right now. Retrying…</p> : null}
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
              {previewPeople.length ? (
                <GithubAvatarStack people={previewPeople} size={20} max={3} />
              ) : (
                <span aria-hidden className="h-5 w-5 rounded-full border border-dashed border-line-2" />
              )}
              <span className="ml-auto font-mono text-[11px] text-ink-3">
                mcap{" "}
                <span className="text-[13px] font-semibold text-ink">
                  <Flash value={launch?.marketCap}>{launch ? `${compact(launch.marketCap)} SOL` : "–"}</Flash>
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Progress value={launch?.progress ?? 0} size="sm" />
              </div>
              <span className="num text-[11px] font-semibold text-ink-2">{`${progressText(launch?.progress ?? 0)}%`}</span>
            </div>
            <div className="flex items-center justify-between border-t border-line pt-2.5 font-mono text-[11px] text-ink-3">
              <span>fees waiting to split</span>
              <span className="text-up-ink">0 SOL</span>
            </div>
          </div>

          {/* The split, in the account colors. */}
          <div className="card mt-3 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="eyebrow">Fee split</span>
              <span className="font-mono text-[11px] text-ink-3">{accountsPct.toLocaleString("en-US", { maximumFractionDigits: 2 })}% of the creator fee</span>
            </div>
            <SplitBar className="mt-3" shares={shares} labels={shareLabels} hot={hot} onHot={setHot} />
            <ul className="-mx-2 mt-2">
              {rows.map((_, i) => {
                const h = handles[i];
                const valid = isValidLogin(h);
                const prof = valid ? profiles.data?.[h] : undefined;
                return (
                  <li
                    key={i}
                    onMouseEnter={() => setHot(i)}
                    onMouseLeave={() => setHot(null)}
                    className={`flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-200 ${hot === i ? "bg-card-2" : ""}`}
                  >
                    {/* The ring is the account's color in the bar. GithubAvatar draws a 2px card-colored
                        ring of its own, so 4px of padding leaves 2px of color showing around it. */}
                    <span aria-hidden className="flex shrink-0 rounded-full p-1" style={swatch(i)}>
                      {valid ? <GithubAvatar id={prof?.id} login={h} size={24} /> : <span className="h-6 w-6 rounded-full bg-card ring-2 ring-card" />}
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
            {!handles.some(isValidLogin) ? <p className="mt-2 text-[12px] text-ink-3">Add GitHub accounts to see the split.</p> : null}
          </div>
          <p className="mt-3 px-1 text-[11px] leading-relaxed text-ink-3">Fees go to each developer&apos;s pump.fun GitHub account, keyed by the permanent GitHub id, so a rename never moves them.</p>
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
                  <div className="eyebrow">Launch on pump.fun</div>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">
                    A normal pump.fun coin whose creator fees are shared for good through pump.fun&apos;s own fee sharing:{" "}
                    <b className="font-semibold text-ink">{accountsPct.toLocaleString("en-US", { maximumFractionDigits: 2 })}% to your GitHub developers</b>,{" "}
                    {PLATFORM_BPS / 100}% to Splitdev. Once set, nobody can change it, not even you.
                  </p>
                </div>
              </div>

              <dl className="space-y-2 border-t border-dashed border-line-2 pt-4 font-mono text-[12px]">
                {LAUNCH_FEE_LAMPORTS > 0n ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-3">Splitdev launch fee</dt>
                    <dd className="text-ink">{formatSol(LAUNCH_FEE_LAMPORTS)} SOL</dd>
                  </div>
                ) : null}
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-3">First buy</dt>
                  <dd className="text-ink">{firstBuy === undefined ? "–" : `${formatSol(firstBuy)} SOL`}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
                  <dt className="text-ink-2">You pay</dt>
                  <dd className="text-right">
                    <span className="text-[14px] font-semibold text-ink">
                      <Flash value={firstBuy === undefined ? undefined : Number(total)}>{firstBuy === undefined ? "–" : `${formatSol(total)} SOL`}</Flash>
                    </span>{" "}
                    <span className="text-ink-3">+ about {formatSol(LAUNCH_RENT_LAMPORTS, 2)} SOL in network fees and account rent</span>
                  </dd>
                </div>
              </dl>

              {pending ? (
                <div className="rounded-2xl border border-sun bg-card-2 p-4 text-[13px] leading-relaxed text-ink-2">
                  <div className="eyebrow !text-ink">Unfinished launch</div>
                  <p className="mt-1.5">
                    ${pending.symbol} was created but its fee split isn&apos;t set yet, so it isn&apos;t a Splitdev coin and its fees go to you. Finish it now to lock the split.
                  </p>
                  <button type="button" className="btn-secondary mt-3 px-4 py-2 text-[14px]" disabled={Boolean(status)} onClick={finishPending}>
                    Finish ${pending.symbol}&apos;s launch
                  </button>
                </div>
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
              {short ? (
                <p className="flex items-start gap-2.5 rounded-2xl bg-down-soft px-4 py-3 text-[13px] text-down-ink">
                  <AlertIcon />
                  <span>This wallet doesn&apos;t have enough SOL for the launch (the amount above plus fees and rent).</span>
                </p>
              ) : null}
              {!live ? (
                <p className="flex items-start gap-2.5 rounded-2xl bg-card-2 px-4 py-3 text-[13px] text-ink-2">
                  <AlertIcon />
                  <span>Splitdev isn&apos;t set up yet, so launches are off.</span>
                </p>
              ) : null}

              <button className="btn-neon group/cta w-full py-4 text-[17px] sm:py-[18px] sm:text-[18px]" disabled={launchDisabled} onClick={() => guard(submit)}>
                {status ? <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
                {!connected ? "Connect wallet to launch" : status ?? (!live ? "Launches are off" : "Launch coin")}
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
  const rest = Math.max(0, SHARES_TOTAL - shares.reduce((a, b) => a + b, 0));
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

function ChatIcon() {
  return (
    <svg {...ICON}>
      <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
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
