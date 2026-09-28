"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { decodeEventLog, formatEther, parseEther, type Hex } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { TokenAvatar } from "@/components/TokenAvatar";
import { XAvatar } from "@/components/XAvatar";
import { launchpadAbi } from "@/lib/abi";
import { activeChain } from "@/lib/chains";
import { BPS, LAUNCHPAD_ADDRESS, MAX_RECIPIENTS } from "@/lib/config";
import { errorMessage, pct } from "@/lib/format";
import { isValidHandle, normalizeHandle } from "@/lib/handles";
import { readLaunchTerms, useDebounced, useLaunchesPaused, useLaunchTerms, useXProfiles } from "@/lib/hooks";
import { useRiskGate } from "@/components/RiskNotice";
import { encodeMetadata, safeUrl } from "@/lib/metadata";
import { useServerConfig } from "@/lib/useServerConfig";

type Row = { handle: string; percent: string };

function toBps(percent: string): number {
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(percent.trim())) return NaN;
  return Math.round(parseFloat(percent) * 100);
}

/** The contract limits lengths in UTF-8 bytes, not characters (emoji and accents take more). */
const byteLength = (v: string) => new TextEncoder().encode(v).length;

function safeParseEther(v: string): bigint | undefined {
  try {
    return v.trim() ? parseEther(v.trim()) : 0n;
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

  const handles = useMemo(() => rows.map((r) => normalizeHandle(r.handle)), [rows]);
  const bps = useMemo(() => rows.map((r) => toBps(r.percent)), [rows]);
  const totalBps = bps.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0);

  // Debounce a string, not an array: a fresh array every render would re-arm the timer forever.
  const lookupKey = useDebounced(handles.filter(isValidHandle).join(","));
  const lookup = useMemo(() => (lookupKey ? lookupKey.split(",") : []), [lookupKey]);
  const profiles = useXProfiles(lookup);
  const inFlight = useRef(false);

  const imageUrl = image.trim() ? safeUrl(image.trim()) : undefined;

  const metadata = useMemo(
    () => encodeMetadata({ image: image.trim(), description: description.trim(), website: website.trim(), telegram: telegram.trim(), twitter: twitter.trim() }),
    [image, description, website, telegram, twitter]
  );

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!name.trim()) p.push("Give your coin a name.");
    else if (byteLength(name.trim()) > 32) p.push("The name is too long (32 bytes max; emoji and accented letters count double or more).");
    if (!symbol.trim() || byteLength(symbol.trim()) > 10) p.push("Add a ticker (up to 10 letters or digits).");
    if (byteLength(metadata) > 2000) p.push("Description and links are too long together; shorten the description.");
    if (image.trim() && !imageUrl) p.push("Image must be an https:// or ipfs:// link.");
    for (const [label, v] of [["Website", website], ["Telegram", telegram], ["X link", twitter]] as const) {
      if (v.trim() && !safeUrl(v.trim())) p.push(`${label} must be an https:// link.`);
    }
    handles.forEach((h, i) => {
      if (!isValidHandle(h)) p.push(`Account ${i + 1}: enter an X username.`);
      else if (profiles.data && h in profiles.data && profiles.data[h] === null) p.push(`@${h} doesn't exist on X.`);
    });
    if (new Set(handles).size !== handles.length) p.push("Each X account can only appear once.");
    if (bps.some((b) => Number.isNaN(b) || b <= 0)) p.push("Every share must be above 0% (2 decimals max).");
    else if (totalBps !== BPS) p.push(`Shares add up to ${pct(totalBps)}; they need to total 100%.`);
    if (safeParseEther(devBuy) === undefined) p.push("First buy must be a number.");
    return p;
  }, [name, symbol, metadata, image, imageUrl, website, telegram, twitter, handles, bps, totalBps, devBuy, profiles.data]);

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
        throw new Error("The launch terms just changed. Review the updated fee below and launch again.");
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

  return (
    <div className="grid gap-8 pt-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-[40px] font-bold tracking-[-0.03em]">Launch a coin</h1>
          <p className="mt-1 text-[15px] text-ink-2">Every trade pays the X accounts you add below. Forever.</p>
        </div>

        <section className="card space-y-5 p-5 sm:p-6">
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => server?.uploads && fileRef.current?.click()}
              className={`group relative shrink-0 ${server?.uploads ? "cursor-pointer" : "cursor-default"}`}
              aria-label="Coin image"
            >
              <TokenAvatar src={imageUrl} seed={previewSeed} size={96} />
              {server?.uploads ? (
                <span className="absolute inset-0 grid place-items-center rounded-[27px] bg-black/40 text-[12px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
                  {uploading ? "Uploading…" : "Upload"}
                </span>
              ) : null}
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <div className="grid flex-1 gap-3 sm:grid-cols-[1fr_9rem]">
              <div>
                <label className="label" htmlFor="name">Name</label>
                <input id="name" className="input" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Pon Coin" />
              </div>
              <div>
                <label className="label" htmlFor="ticker">Ticker</label>
                <input
                  id="ticker"
                  className="input font-semibold uppercase"
                  maxLength={10}
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                  placeholder="PON"
                />
              </div>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="image">Image {server?.uploads ? "(upload by tapping the picture, or paste a link)" : "link"}</label>
            <input id="image" className="input" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://… or ipfs://…  (empty = a generated sticker)" />
          </div>
          <div>
            <label className="label" htmlFor="desc">Description</label>
            <textarea id="desc" className="input min-h-24 resize-y" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's the story?" />
          </div>
          {showLinks ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <input className="input" aria-label="Website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website" />
              <input className="input" aria-label="Telegram" value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="Telegram link" />
              <input className="input" aria-label="X link" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="X post or profile link" />
            </div>
          ) : (
            <button type="button" className="text-[14px] font-medium text-ink-2 hover:text-ink" onClick={() => setShowLinks(true)}>
              + Add links (website, Telegram, X)
            </button>
          )}
        </section>

        <section className="card space-y-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[19px] font-semibold tracking-tight">Who gets the fees</h2>
              <p className="text-[13px] text-ink-2">Up to {MAX_RECIPIENTS} X accounts. Locked in at launch.</p>
            </div>
            <button type="button" className="chip hover:text-ink" onClick={() => setRows((rs) => evenSplit(rs.length).map((p, i) => ({ ...rs[i], percent: p })))}>
              Split evenly
            </button>
          </div>
          <div className="space-y-2.5">
            {rows.map((r, i) => {
              const h = handles[i];
              const prof = profiles.data?.[h];
              return (
                <div key={i} className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <div className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
                      {isValidHandle(h) ? <XAvatar handle={h} image={prof?.image} size={30} /> : <div className="h-[30px] w-[30px] rounded-full bg-card" />}
                    </div>
                    <input
                      className="input pl-12 pr-3"
                      value={r.handle}
                      onChange={(e) => update(i, { handle: e.target.value.replace(/^@+/, "") })}
                      placeholder="username"
                      aria-label={`X account ${i + 1}`}
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                    {prof ? (
                      <span className="pointer-events-none absolute right-3 top-1/2 max-w-[40%] -translate-y-1/2 truncate text-[12px] font-medium text-up-ink">✓ {prof.name}</span>
                    ) : isValidHandle(h) && profiles.data && h in profiles.data ? (
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-down-ink">not found</span>
                    ) : null}
                  </div>
                  <div className="relative w-24">
                    <input className="input num pr-7 text-right" inputMode="decimal" aria-label={`Share ${i + 1}`} value={r.percent} onChange={(e) => update(i, { percent: e.target.value })} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-2">%</span>
                  </div>
                  <button
                    type="button"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[18px] text-ink-2 hover:bg-card-2 hover:text-ink disabled:opacity-30"
                    disabled={rows.length === 1}
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    aria-label={`Remove account ${i + 1}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between">
            <button type="button" className="btn-secondary px-4 py-2 text-[14px]" disabled={rows.length >= MAX_RECIPIENTS} onClick={() => setRows((rs) => [...rs, { handle: "", percent: "0" }])}>
              + Add account
            </button>
            <span className={`num text-[14px] font-semibold ${totalBps === BPS ? "text-up-ink" : "text-down-ink"}`}>{pct(totalBps)} / 100%</span>
          </div>
          {profiles.error ? <p className="text-[12px] text-ink-2">Profile lookup is unavailable right now ({(profiles.error as Error).message}); accounts are verified when you launch.</p> : null}
        </section>

        <section className="card p-5 sm:p-6">
          <label className="label" htmlFor="devbuy">Be the first buyer (optional)</label>
          <div className="relative">
            <input id="devbuy" className="input num pr-14 text-[17px]" inputMode="decimal" placeholder="0" value={devBuy} onChange={(e) => setDevBuy(e.target.value.replace(",", "."))} />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-semibold text-ink-2">ETH</span>
          </div>
          <p className="mt-2 text-[12px] text-ink-2">Bought in the same transaction as the launch, so nobody gets in before you.{creationFee === undefined ? "" : creationFee > 0n ? ` Launch fee ${formatEther(creationFee)} ETH, paid on top.` : " Launching is free."}</p>
          {terms.isError && !shownTerms ? (
            <p className="mt-2 text-[12px] font-medium text-down-ink">Can&apos;t read the launch terms from {activeChain.name} right now. Retrying…</p>
          ) : null}
        </section>

        {problems.length > 0 && touched ? (
          <ul className="space-y-1 text-[13px] text-down-ink">
            {problems.map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        ) : null}
        {error ? <p role="alert" className="text-[14px] font-medium text-down-ink">{error}</p> : null}
        {server && !server.signer ? <p className="text-[13px] text-down-ink">This server has no signer configured, so launches are disabled.</p> : null}

        {feeBps !== undefined && protocolShareBps !== undefined ? (
          <p className="text-center text-[13px] text-ink-2">
            Terms locked in at launch: {Number(feeBps) / 100}% fee on every trade, of which{" "}
            <b className="text-ink">{(10_000 - Number(protocolShareBps)) / 100}% goes to your X accounts</b>.
          </p>
        ) : null}
        {paused ? <p className="text-center text-[14px] font-medium text-down-ink">New launches are paused by the owner for now.</p> : null}
        <button className="btn-sticker w-full py-4 text-[17px]" disabled={Boolean(status) || paused === true || (isConnected && (problems.length > 0 || !shownTerms))} onClick={() => guard(submit)}>
          {!isConnected ? "Connect wallet to launch" : status ?? (shownTerms ? "Launch coin" : "Reading launch terms…")}
        </button>
        {dialog}
      </div>

      <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
        <div className="text-[12px] font-semibold uppercase tracking-wider text-ink-3">Preview</div>
        <div className="card flex gap-3.5 p-3.5">
          <TokenAvatar src={imageUrl} seed={previewSeed} size={84} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="truncate text-[15px] font-semibold">{name || "Your coin"}</span>
              <span className="text-[13px] font-medium text-ink-2">${(symbol || "TICKER").toUpperCase()}</span>
            </div>
            <p className="mt-1 line-clamp-3 text-[13px] text-ink-2">{description || "Your description shows up here."}</p>
          </div>
        </div>
        <div className="card space-y-2.5 p-4">
          {handles.map((h, i) =>
            isValidHandle(h) ? (
              <div key={i} className="flex items-center gap-2.5">
                <XAvatar handle={h} image={profiles.data?.[h]?.image} size={26} />
                <span className="flex-1 truncate text-[14px] font-medium">@{h}</span>
                <span className="num text-[14px] font-semibold">{Number.isNaN(bps[i]) ? "–" : pct(bps[i])}</span>
              </div>
            ) : null
          )}
          {!handles.some(isValidHandle) ? <p className="text-[13px] text-ink-2">Add X accounts to see the split.</p> : null}
        </div>
      </aside>
    </div>
  );
}
