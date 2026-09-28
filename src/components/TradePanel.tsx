"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { formatUnits, parseEther, parseEventLogs, type Address } from "viem";
import { useAccount, useBalance, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { launchpadAbi, splitTokenAbi } from "@/lib/abi";
import { activeChain } from "@/lib/chains";
import { FAUCET_URL, LAUNCHPAD_ADDRESS } from "@/lib/config";
import { errorMessage, formatEth, formatTokens } from "@/lib/format";
import { useRiskGate } from "./RiskNotice";

const SLIPPAGES = [50n, 100n, 200n, 500n]; // bps
/** ETH kept back for gas when buying with "Balance" (ETH is Robinhood Chain's gas token). */
const GAS_RESERVE = parseEther("0.0002");

function parse(v: string): bigint | undefined {
  try {
    const n = parseEther(v.trim());
    return n > 0n ? n : undefined;
  } catch {
    return undefined;
  }
}

export function TradePanel({ token, symbol, graduated, onTraded }: { token: Address; symbol: string; graduated: boolean; onTraded: () => void }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(200n);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { writeContractAsync } = useWriteContract();
  const { guard, dialog } = useRiskGate();

  const { data: ethBalance, refetch: refetchEth } = useBalance({ address, chainId: activeChain.id });
  const { data: tokenBalance, refetch: refetchToken } = useReadContract({
    address: token,
    abi: splitTokenAbi,
    chainId: activeChain.id,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const parsed = parse(amount);
  const { data: buyQuote } = useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    chainId: activeChain.id,
    functionName: "quoteBuy",
    args: parsed ? [token, parsed] : undefined,
    query: { enabled: side === "buy" && Boolean(parsed && LAUNCHPAD_ADDRESS), refetchInterval: 5_000 },
  });
  const { data: sellQuote } = useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    chainId: activeChain.id,
    functionName: "quoteSell",
    args: parsed ? [token, parsed] : undefined,
    query: { enabled: side === "sell" && Boolean(parsed && LAUNCHPAD_ADDRESS), refetchInterval: 5_000 },
  });

  const out = side === "buy" ? buyQuote?.[0] : sellQuote?.[0];
  const fee = side === "buy" ? buyQuote?.[1] : sellQuote?.[1];
  const refund = side === "buy" ? buyQuote?.[2] : 0n;
  const balance = side === "buy" ? ethBalance?.value : tokenBalance;
  const insufficient = parsed !== undefined && balance !== undefined && parsed > balance;
  const noGasLeft = side === "buy" && !insufficient && parsed !== undefined && balance !== undefined && parsed + GAS_RESERVE > balance;
  const noEth = isConnected && side === "buy" && ethBalance?.value === 0n;

  const presets =
    side === "buy"
      ? ["0.01", "0.05", "0.1", "0.5"].map((v) => ({ label: `${v} Ξ`, value: v }))
      : [25, 50, 75, 100].map((p) => ({ label: p === 100 ? "Max" : `${p}%`, value: tokenBalance ? formatUnits((tokenBalance * BigInt(p)) / 100n, 18) : "" }));

  async function trade() {
    setMsg(null);
    if (!isConnected) return openConnectModal?.();
    if (!LAUNCHPAD_ADDRESS || !publicClient || !parsed || !out) return;
    // The quote the user saw when they clicked is what the slippage setting protects.
    const shown = out;
    const min = (shown * (10_000n - slippage)) / 10_000n;
    setBusy(true);
    try {
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      // Re-quote before asking the wallet: if the price already moved past the slippage limit,
      // stop here (and let the refreshed quote show) instead of sending a doomed transaction.
      const fresh =
        side === "buy"
          ? (await publicClient.readContract({ address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, functionName: "quoteBuy", args: [token, parsed] }))[0]
          : (await publicClient.readContract({ address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, functionName: "quoteSell", args: [token, parsed] }))[0];
      if (fresh < min || fresh === 0n) throw new Error("The price moved since your quote. Check the new amount and try again.");
      const hash =
        side === "buy"
          ? await writeContractAsync({ address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, chainId: activeChain.id, functionName: "buy", args: [token, min], value: parsed })
          : await writeContractAsync({ address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, chainId: activeChain.id, functionName: "sell", args: [token, parsed, min] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      // Report what the trade actually did, from its Trade event.
      const ev = parseEventLogs({ abi: launchpadAbi, eventName: "Trade", logs: receipt.logs }).find(
        (l) => l.address.toLowerCase() === LAUNCHPAD_ADDRESS!.toLowerCase()
      )?.args;
      const got = side === "buy" ? (ev?.tokenAmount ?? fresh) : (ev?.ethAmount ?? fresh);
      setMsg({ kind: "ok", text: side === "buy" ? `Bought ${formatTokens(got)} ${symbol}` : `Sold for ${formatEth(got)} ETH` });
      setAmount("");
      refetchEth();
      refetchToken();
      onTraded();
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
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
              Balance {side === "buy" ? `${ethBalance ? formatEth(ethBalance.value) : "–"} ETH` : `${tokenBalance !== undefined ? formatTokens(tokenBalance) : "–"} ${symbol}`}
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
            aria-label={side === "buy" ? "ETH amount" : `${symbol} amount`}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(",", "."))}
          />
          <span className="pointer-events-none inline-flex max-w-[45%] shrink-0 items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1.5 font-mono text-[12px] font-semibold text-ink">
            {buying ? (
              <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-ink text-[10px] leading-none text-paper">
                Ξ
              </span>
            ) : null}
            <span className="truncate">{buying ? "ETH" : symbol}</span>
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
          <Row label="You receive" value={out ? (side === "buy" ? `${formatTokens(out)} ${symbol}` : `${formatEth(out, 6)} ETH`) : "–"} strong />
          <Row label="Fee to X accounts + protocol" value={fee ? `${formatEth(fee, 6)} ETH` : "–"} className="!mt-2.5 border-t border-dashed border-line pt-2.5" />
          {refund ? <Row label="Refund (curve sells out)" value={`${formatEth(refund, 6)} ETH`} /> : null}
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
                <button key={s.toString()} data-active={slippage === s} onClick={() => setSlippage(s)} className="relative after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] !px-2.5 !py-1.5 font-mono !text-[11px]">
                  {Number(s) / 100}%
                </button>
              ))}
            </dd>
          </div>
        </dl>
      </div>

      <button
        className={`w-full !py-4 text-[16px] ${!isConnected ? "btn-neon" : buying ? "btn-buy" : "btn-sell"}`}
        disabled={isConnected && (busy || !parsed || !out || insufficient || noGasLeft)}
        onClick={() => guard(trade)}
      >
        {busy ? <Spinner /> : null}
        {!isConnected
          ? "Connect wallet"
          : busy
            ? "Confirming…"
            : insufficient
              ? "Insufficient balance"
              : noGasLeft
                ? "Leave a little ETH for gas"
                : `${side === "buy" ? "Buy" : "Sell"} ${symbol}`}
      </button>
      {noEth && activeChain.testnet ? (
        <p className="text-center text-[12px] text-ink-2">
          No test ETH yet?{" "}
          <a className="font-medium text-ink underline" href={FAUCET_URL} target="_blank" rel="noreferrer">
            Get some from the faucet
          </a>
        </p>
      ) : null}
      {msg ? (
        <p
          role="status"
          className={`flex animate-pop items-start justify-center gap-2 rounded-2xl px-3 py-2.5 text-center text-[13px] font-medium ${
            msg.kind === "ok" ? "bg-up-soft text-up-ink" : "bg-down-soft text-down-ink"
          }`}
        >
          <StatusIcon ok={msg.kind === "ok"} />
          <span className="min-w-0 break-words">{msg.text}</span>
        </p>
      ) : null}
      {dialog}
      <p className="text-center font-mono text-[10.5px] leading-relaxed text-ink-3">
        <span aria-hidden className={`mr-2 inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full align-middle ${graduated ? "bg-up" : "bg-lime"}`} />
        {graduated ? (
          // Too long for one line in the panel, so it breaks where the separator is.
          <>
            Trading in the PonSwap pool<span className="sr-only"> · </span>
            <span className="block">liquidity locked forever</span>
          </>
        ) : (
          "Trading on the bonding curve"
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
