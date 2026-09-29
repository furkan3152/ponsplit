"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { formatUnits, parseEther, parseEventLogs, type Address, type Hex } from "viem";
import { useAccount, useBalance, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { ponsCurveAbi, ponsFactoryAbi, ponsTokenAbi, routerAbi } from "@/lib/abi";
import { errorMessage, formatEth, formatTokens } from "@/lib/format";
import { clientFor, useLauncherInfo } from "@/lib/hooks";
import { useNetwork } from "@/lib/network-context";
import { BPS, PONS_FEE_BPS, PONS_PROTOCOL_SHARE_BPS, minOut, quoteCurveBuy, quoteCurveSell, type CurveTerms } from "@/lib/pons";
import type { Coin } from "@/lib/types";
import { useRiskGate } from "./RiskNotice";

const SLIPPAGES = [50, 100, 200, 500]; // bps
/** ETH kept back for gas when buying with "Balance" (ETH is Robinhood Chain's gas token). */
const GAS_RESERVE = parseEther("0.0002");
/** How long a pool trade may wait in the mempool before it's refused (the router's deadline). */
const DEADLINE_SECONDS = 600n;

function parse(v: string): bigint | undefined {
  try {
    const n = parseEther(v.trim());
    return n > 0n ? n : undefined;
  } catch {
    return undefined;
  }
}

type Quote = { out: bigint; spent: bigint; refund: bigint };

/**
 * Buys and sells a coin where it trades right now: on its pons bonding curve, then (after the
 * crossing buy and the pool's creation) in its pons Uniswap v4 pool through SplitEarn's router. In
 * between, anyone can push the graduation along; pons's own keeper usually does it first.
 */
/** `live`: the coin's reserves were just read from the chain (not a placeholder); trades wait for that. */
export function TradePanel({ coin, onTraded, live = true }: { coin: Coin; onTraded: () => void; live?: boolean }) {
  const n = useNetwork();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(200);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const lock = useRef(false);

  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { guard, dialog } = useRiskGate();
  const { data: wiring } = useLauncherInfo();
  const client = clientFor(n);

  const onCurve = coin.phase === "curve";
  const onPool = coin.phase === "pool";
  const soldOut = onCurve && coin.sellable === 0n;
  const spender: Address | undefined = onCurve ? coin.curve : onPool ? wiring?.router : undefined;

  const { data: ethBalance, refetch: refetchEth } = useBalance({ address, chainId: n.chain.id });
  const { data: tokenBalance, refetch: refetchToken } = useReadContract({
    address: coin.token,
    abi: ponsTokenAbi,
    chainId: n.chain.id,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: coin.token,
    abi: ponsTokenAbi,
    chainId: n.chain.id,
    functionName: "allowance",
    args: address && spender ? [address, spender] : undefined,
    query: { enabled: Boolean(address && spender && side === "sell") },
  });
  // The curve's base fee is fixed per launch (1% on pons's standard terms).
  const { data: curveFee } = useReadContract({
    address: coin.curve,
    abi: ponsCurveAbi,
    chainId: n.chain.id,
    functionName: "feeBps",
    query: { staleTime: Infinity },
  });
  // Pons taxes buys heavily in a coin's first seconds (not the launcher's own first buy). Only a
  // coin that young needs the check.
  const young = Date.now() / 1000 - coin.createdAt < 90;
  const { data: snipe } = useReadContract({
    address: coin.curve,
    abi: ponsCurveAbi,
    chainId: n.chain.id,
    functionName: "currentSnipeTaxBps",
    args: [address ?? "0x0000000000000000000000000000000000000001"],
    query: { enabled: onCurve && young, refetchInterval: 1_000 },
  });

  const parsed = parse(amount);
  const terms: CurveTerms = {
    quoteReserve: coin.quoteReserve,
    tokenReserve: coin.tokenReserve,
    sellable: coin.sellable,
    feeBps: curveFee ?? BigInt(PONS_FEE_BPS),
    creatorTaxBps: BigInt(coin.creatorTaxBps),
    snipeBps: young ? (snipe ?? 0n) : 0n,
  };
  const curveQuote = (s: "buy" | "sell", v: bigint, t: CurveTerms): Quote => {
    if (s === "sell") return { out: quoteCurveSell(t, v), spent: v, refund: 0n };
    const q = quoteCurveBuy(t, v);
    return { out: q.tokensOut, spent: q.spent, refund: q.refund };
  };
  const poolQuote = useQuery({
    queryKey: ["pool-quote", n.id, coin.token, side, parsed?.toString()],
    enabled: onPool && Boolean(parsed && wiring),
    refetchInterval: 5_000,
    queryFn: async (): Promise<Quote> => {
      const { result } = await client.simulateContract({ address: wiring!.router, abi: routerAbi, functionName: "quote", args: [coin.token, side === "buy", parsed!] });
      return { out: result, spent: parsed!, refund: 0n };
    },
  });
  const quote: Quote | undefined = !parsed ? undefined : onCurve ? curveQuote(side, parsed, terms) : onPool ? poolQuote.data : undefined;

  const balance = side === "buy" ? ethBalance?.value : tokenBalance;
  const insufficient = parsed !== undefined && balance !== undefined && parsed > balance;
  const noGasLeft = side === "buy" && !insufficient && parsed !== undefined && balance !== undefined && parsed + GAS_RESERVE > balance;
  const noEth = isConnected && side === "buy" && ethBalance?.value === 0n;
  const needsApproval = side === "sell" && parsed !== undefined && allowance !== undefined && allowance < parsed;

  // What this trade pays the coin's X accounts: the creator's part of the base fee plus the creator
  // tax, less SplitEarn's share. On the curve both come out of the ETH side.
  const ethSide = quote ? (side === "buy" ? quote.spent : quote.out) : undefined;
  const feeBps = Number(terms.feeBps);
  const toAccounts =
    ethSide === undefined
      ? undefined
      : ((((ethSide * BigInt(feeBps) * BigInt(10_000 - PONS_PROTOCOL_SHARE_BPS)) / BPS / BPS + (ethSide * BigInt(coin.creatorTaxBps)) / BPS) *
          BigInt(10_000 - coin.platformBps)) /
        BPS);

  const presets =
    side === "buy"
      ? ["0.01", "0.05", "0.1", "0.5"].map((v) => ({ label: `${v} Ξ`, value: v }))
      : [25, 50, 75, 100].map((p) => ({ label: p === 100 ? "Max" : `${p}%`, value: tokenBalance ? formatUnits((tokenBalance * BigInt(p)) / 100n, 18) : "" }));

  async function send(label: string, write: () => Promise<Hex>) {
    setBusy(label);
    const hash = await write();
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Transaction reverted");
    return receipt;
  }

  async function ensureChain() {
    if (chainId !== n.chain.id) {
      setBusy("Switching network…");
      await switchChainAsync({ chainId: n.chain.id });
    }
  }

  async function trade() {
    setMsg(null);
    if (!isConnected || !address) return openConnectModal?.();
    if (!live || !parsed || !quote || !quote.out || lock.current) return;
    lock.current = true;
    // The quote on screen when the button was pressed is what the slippage setting protects.
    const floor = minOut(quote.out, slippage);
    try {
      await ensureChain();
      setBusy("Checking the price…");
      if (side === "sell" && spender && (await client.readContract({ address: coin.token, abi: ponsTokenAbi, functionName: "allowance", args: [address, spender] })) < parsed) {
        await send("Approve in your wallet…", () =>
          writeContractAsync({ address: coin.token, abi: ponsTokenAbi, chainId: n.chain.id, functionName: "approve", args: [spender, parsed] })
        );
        void refetchAllowance();
      }
      let got: bigint | undefined;
      if (onCurve) {
        // Re-price on the curve's current reserves: if it already moved past the limit, stop here
        // rather than send a transaction that would revert.
        const [[quoteReserve, tokenReserve], sellable] = await Promise.all([
          client.readContract({ address: coin.curve, abi: ponsCurveAbi, functionName: "getReserves" }),
          client.readContract({ address: coin.curve, abi: ponsCurveAbi, functionName: "sellableTokens" }),
        ]);
        const fresh = curveQuote(side, parsed, { ...terms, quoteReserve, tokenReserve, sellable });
        if (fresh.out < floor || fresh.out === 0n) throw new Error("The price moved since your quote. Check the new amount and try again.");
        const receipt =
          side === "buy"
            ? await send("Confirm in your wallet…", () =>
                writeContractAsync({ address: coin.curve, abi: ponsCurveAbi, chainId: n.chain.id, functionName: "buy", args: [parsed, floor, address], value: parsed })
              )
            : await send("Confirm in your wallet…", () =>
                writeContractAsync({ address: coin.curve, abi: ponsCurveAbi, chainId: n.chain.id, functionName: "sell", args: [parsed, floor, address] })
              );
        const logs = parseEventLogs({ abi: ponsCurveAbi, logs: receipt.logs }).filter((l) => l.address.toLowerCase() === coin.curve.toLowerCase());
        const ev = logs.find((l) => l.eventName === (side === "buy" ? "CurveBuy" : "CurveSell"))?.args as { tokensOut?: bigint; quoteOut?: bigint } | undefined;
        got = side === "buy" ? ev?.tokensOut : ev?.quoteOut;
      } else if (onPool && wiring) {
        const { result: fresh } = await client.simulateContract({ address: wiring.router, abi: routerAbi, functionName: "quote", args: [coin.token, side === "buy", parsed] });
        if (fresh < floor || fresh === 0n) throw new Error("The price moved since your quote. Check the new amount and try again.");
        const deadline = BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_SECONDS;
        const receipt =
          side === "buy"
            ? await send("Confirm in your wallet…", () =>
                writeContractAsync({ address: wiring.router, abi: routerAbi, chainId: n.chain.id, functionName: "buy", args: [coin.token, floor, address, deadline], value: parsed })
              )
            : await send("Confirm in your wallet…", () =>
                writeContractAsync({ address: wiring.router, abi: routerAbi, chainId: n.chain.id, functionName: "sell", args: [coin.token, parsed, floor, address, deadline] })
              );
        const ev = parseEventLogs({ abi: routerAbi, eventName: "PoolTrade", logs: receipt.logs })[0]?.args;
        got = side === "buy" ? ev?.tokenAmount : ev?.ethAmount;
      }
      const out = got ?? quote.out;
      setMsg({ kind: "ok", text: side === "buy" ? `Bought ${formatTokens(out)} ${coin.symbol}` : `Sold for ${formatEth(out)} ETH` });
      setAmount("");
      void refetchEth();
      void refetchToken();
      onTraded();
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(null);
      lock.current = false;
    }
  }

  /** Moves a graduating coin along: sweeps a sold-out curve, or creates its Uniswap v4 pool. */
  async function graduate() {
    setMsg(null);
    if (!isConnected) return openConnectModal?.();
    if (!wiring || lock.current) return;
    lock.current = true;
    try {
      await ensureChain();
      const functionName = coin.phase === "graduating" ? "createGraduatedPool" : "graduate";
      await send("Confirm in your wallet…", () =>
        writeContractAsync({ address: wiring.ponsFactory, abi: ponsFactoryAbi, chainId: n.chain.id, functionName, args: [coin.token] })
      );
      setMsg({ kind: "ok", text: functionName === "graduate" ? "The curve is closed; next, its pool." : "The pool is live. Trading continues here." });
      onTraded();
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(null);
      lock.current = false;
    }
  }

  if (coin.phase === "graduating" || soldOut) {
    return (
      <div className="card relative isolate space-y-4 overflow-hidden p-4 sm:p-5">
        <div className="eyebrow">Graduating</div>
        <h2 className="display text-[26px] leading-none">{soldOut ? "The curve sold out" : "Opening the pool"}</h2>
        <p className="text-[14px] leading-relaxed text-ink-2">
          {soldOut
            ? "The last buy sold the curve out. Once it is swept, pons puts the ETH and the reserved coins into a Uniswap v4 pool with locked liquidity, and trading continues there."
            : "The curve has sold out and its ETH and reserved coins are waiting to seed the Uniswap v4 pool. pons usually creates it within moments; anyone can do it now."}
        </p>
        <button className="btn-neon w-full !py-4 text-[16px]" disabled={Boolean(busy) || !wiring} onClick={graduate}>
          {busy ? <Spinner /> : null}
          {!isConnected ? "Connect wallet" : busy ?? (soldOut ? "Close the curve" : "Create the pool")}
        </button>
        {msg ? <Status msg={msg} /> : null}
      </div>
    );
  }

  if (coin.phase === "rescued") {
    return (
      <div className="card space-y-3 p-4 sm:p-5">
        <div className="eyebrow">Not trading</div>
        <p className="text-[14px] leading-relaxed text-ink-2">
          pons couldn&apos;t seed this coin&apos;s pool and returned its reserves instead, so it no longer trades on pons.
        </p>
      </div>
    );
  }

  const buying = side === "buy";

  return (
    <div className="card relative isolate space-y-4 overflow-hidden p-4 sm:p-5">
      <div className="relative grid grid-cols-2 rounded-full border border-line bg-card-2 p-1">
        <span
          aria-hidden
          className={`absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full transition-[transform,background-color,box-shadow] duration-300 ease-out ${
            buying
              ? "translate-x-0 bg-up-soft shadow-[inset_0_0_0_1px_var(--green),0_8px_26px_-10px_var(--green)]"
              : "translate-x-full bg-down-soft shadow-[inset_0_0_0_1px_var(--red),0_8px_26px_-10px_var(--red)]"
          }`}
        />
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            aria-pressed={side === s}
            onClick={() => {
              setSide(s);
              setAmount("");
              setMsg(null);
            }}
            className={`relative h-10 rounded-full text-[14px] font-semibold capitalize transition-colors duration-300 ${
              side === s ? (s === "buy" ? "text-up-ink" : "text-down-ink") : "text-ink-2 hover:text-ink"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div>
        <div className="mb-2 flex min-h-[28px] items-center justify-between gap-3">
          <span className="eyebrow">{buying ? "You pay" : "You sell"}</span>
          {isConnected ? (
            <button
              className="num -mr-2 min-w-0 truncate rounded-full px-2 py-1 text-[11px] text-ink-2 transition hover:bg-card-2 hover:text-ink"
              onClick={() => {
                if (balance === undefined) return;
                const usable = side === "buy" ? (balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n) : balance;
                setAmount(usable > 0n ? formatUnits(usable, 18) : "");
              }}
            >
              Balance {side === "buy" ? `${ethBalance ? formatEth(ethBalance.value) : "–"} ETH` : `${tokenBalance !== undefined ? formatTokens(tokenBalance) : "–"} ${coin.symbol}`}
            </button>
          ) : null}
        </div>
        <div
          className={`flex items-center gap-2 rounded-[20px] border border-line bg-card-2 py-1 pl-4 pr-2 transition focus-within:bg-card focus-within:ring-4 ${
            buying ? "focus-within:border-[var(--green)] focus-within:ring-[var(--green-soft)]" : "focus-within:border-[var(--red)] focus-within:ring-[var(--red-soft)]"
          }`}
        >
          <input
            className="num min-w-0 flex-1 bg-transparent py-3 text-[30px] font-semibold leading-none tracking-tight text-ink outline-none placeholder:text-ink-3"
            inputMode="decimal"
            placeholder="0"
            aria-label={side === "buy" ? "ETH amount" : `${coin.symbol} amount`}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(",", "."))}
          />
          <span className="pointer-events-none inline-flex max-w-[45%] shrink-0 items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1.5 font-mono text-[12px] font-semibold text-ink">
            {buying ? (
              <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-ink text-[10px] leading-none text-paper">
                Ξ
              </span>
            ) : null}
            <span className="truncate">{buying ? "ETH" : coin.symbol}</span>
          </span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {presets.map((p) => (
            <button
              key={p.label}
              data-active={amount !== "" && amount === p.value}
              className="h-10 rounded-full border border-line bg-card-2 font-mono text-[12px] font-medium text-ink-2 transition hover:border-line-2 hover:text-ink active:scale-95 data-[active=true]:border-line-2 data-[active=true]:bg-card-3 data-[active=true]:text-ink"
              onClick={() => setAmount(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* The quote, as a ticket: what you get on top, the costs and your limit below the tear line. */}
      <div className="rounded-[18px] bg-card-2 text-[13px]">
        <dl className="space-y-2 px-4 pb-3 pt-3.5">
          <Row
            label="You receive"
            value={quote?.out ? (buying ? `${formatTokens(quote.out)} ${coin.symbol}` : `${formatEth(quote.out, 6)} ETH`) : onPool && parsed && poolQuote.isFetching ? "…" : "–"}
            strong
          />
          <Row
            label={`Fee ${feeBps / 100}%${coin.creatorTaxBps ? ` + ${coin.creatorTaxBps / 100}% tax` : ""}`}
            value={toAccounts !== undefined ? `${formatEth(toAccounts, 6)} ETH to X` : "–"}
            className="!mt-2.5 border-t border-dashed border-line pt-2.5"
          />
          {terms.snipeBps && onCurve && buying ? <Row label="Opening snipe tax (first seconds)" value={`${Number(terms.snipeBps) / 100}%`} /> : null}
          {quote?.refund ? <Row label="Refund (the curve sells out)" value={`${formatEth(quote.refund, 6)} ETH`} /> : null}
        </dl>
        <div aria-hidden className="relative mx-4 border-t border-dashed border-line-2">
          <span className="absolute -left-[23px] -top-[7px] h-3.5 w-3.5 rounded-full bg-card" />
          <span className="absolute -right-[23px] -top-[7px] h-3.5 w-3.5 rounded-full bg-card" />
        </div>
        <dl className="px-4 pb-3 pt-3">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-2">Slippage</dt>
            <dd className="segmented !p-0.5">
              {SLIPPAGES.map((s) => (
                <button
                  key={s}
                  data-active={slippage === s}
                  onClick={() => setSlippage(s)}
                  className="relative !px-2.5 !py-1.5 font-mono !text-[11px] after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']"
                >
                  {s / 100}%
                </button>
              ))}
            </dd>
          </div>
        </dl>
      </div>

      <button
        className={`w-full !py-4 text-[16px] ${!isConnected ? "btn-neon" : buying ? "btn-buy" : "btn-sell"}`}
        disabled={isConnected && (Boolean(busy) || !live || !parsed || !quote?.out || insufficient || noGasLeft)}
        onClick={() => guard(trade)}
      >
        {busy ? <Spinner /> : null}
        {!isConnected
          ? "Connect wallet"
          : busy
            ? busy
            : insufficient
              ? "Insufficient balance"
              : noGasLeft
                ? "Leave a little ETH for gas"
                : needsApproval
                  ? `Approve and sell ${coin.symbol}`
                  : `${buying ? "Buy" : "Sell"} ${coin.symbol}`}
      </button>
      {noEth && n.faucet ? (
        <p className="text-center text-[12px] text-ink-2">
          No test ETH yet?{" "}
          <a className="font-medium text-ink underline" href={n.faucet} target="_blank" rel="noreferrer">
            Get some from the faucet
          </a>
        </p>
      ) : null}
      {msg ? <Status msg={msg} /> : null}
      {dialog}
      <p className="text-center font-mono text-[10.5px] leading-relaxed text-ink-3">
        <span aria-hidden className={`mr-2 inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full align-middle ${onPool ? "bg-up" : "bg-lime"}`} />
        {onPool ? (
          // Too long for one line in the panel, so it breaks where the separator is.
          <>
            Trading in the pons Uniswap v4 pool<span className="sr-only"> · </span>
            <span className="block">liquidity locked by pons</span>
          </>
        ) : (
          "Trading on the pons bonding curve"
        )}
      </p>
      {/* The active side lights the panel from above: green to buy, red to sell. Last in the DOM so it
          takes no spacing; -z-10 keeps it under everything. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 !mt-0 h-44">
        {(["buy", "sell"] as const).map((s) => (
          <div key={s} className={`absolute inset-0 transition-opacity duration-500 ${side === s ? "opacity-100" : "opacity-0"}`}>
            <div className="absolute inset-0" style={{ background: `radial-gradient(90% 100% at 50% -20%, var(--${s === "buy" ? "green" : "red"}-soft), transparent 72%)` }} />
            <div className="absolute inset-x-10 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, var(--${s === "buy" ? "green" : "red"}), transparent)` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, strong, className = "" }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${className}`}>
      <dt className="text-ink-2">{label}</dt>
      <dd className={`num text-right ${strong ? "text-[15px] font-semibold text-ink" : "text-[12px] text-ink-2"}`}>{value}</dd>
    </div>
  );
}

function Status({ msg }: { msg: { kind: "ok" | "err"; text: string } }) {
  return (
    <p
      role="status"
      className={`flex animate-pop items-start justify-center gap-2 rounded-2xl px-3 py-2.5 text-center text-[13px] font-medium ${
        msg.kind === "ok" ? "bg-up-soft text-up-ink" : "bg-down-soft text-down-ink"
      }`}
    >
      <StatusIcon ok={msg.kind === "ok"} />
      <span className="min-w-0 break-words">{msg.text}</span>
    </p>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function StatusIcon({ ok }: { ok: boolean }) {
  return (
    <svg className="mt-px h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ok ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : <path d="M12 7.5v6M12 17.2v.3M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />}
    </svg>
  );
}
