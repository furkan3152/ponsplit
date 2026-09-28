"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { formatUnits, parseEther, type Address } from "viem";
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
    setBusy(true);
    try {
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      // Re-quote right before sending: the number on screen may be seconds (or a trade) old.
      const fresh =
        side === "buy"
          ? (await publicClient.readContract({ address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, functionName: "quoteBuy", args: [token, parsed] }))[0]
          : (await publicClient.readContract({ address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, functionName: "quoteSell", args: [token, parsed] }))[0];
      if (fresh === 0n) throw new Error("That amount is too small to trade.");
      const min = (fresh * (10_000n - slippage)) / 10_000n;
      const hash =
        side === "buy"
          ? await writeContractAsync({ address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, chainId: activeChain.id, functionName: "buy", args: [token, min], value: parsed })
          : await writeContractAsync({ address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, chainId: activeChain.id, functionName: "sell", args: [token, parsed, min] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      setMsg({ kind: "ok", text: side === "buy" ? `Bought ${formatTokens(fresh)} ${symbol}` : `Sold for ${formatEth(fresh)} ETH` });
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

  return (
    <div className="card space-y-4 p-4">
      <div className="grid grid-cols-2 gap-1 rounded-full bg-card-2 p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setAmount("");
              setMsg(null);
            }}
            className={`rounded-full py-2 text-[14px] font-semibold capitalize transition ${
              side === s ? (s === "buy" ? "bg-up text-white dark:text-black" : "bg-down text-white") : "text-ink-2 hover:text-ink"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div>
        <div className="mb-2 flex justify-between text-[12px] text-ink-2">
          <span>{side === "buy" ? "You pay" : "You sell"}</span>
          {isConnected ? (
            <button
              className="num hover:text-ink"
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
        <div className="relative">
          <input
            className="input num py-3.5 pr-20 text-[22px] font-semibold"
            inputMode="decimal"
            placeholder="0"
            aria-label={side === "buy" ? "ETH amount" : `${symbol} amount`}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(",", "."))}
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[14px] font-semibold text-ink-2">
            {side === "buy" ? "ETH" : symbol}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {presets.map((p) => (
            <button key={p.label} className="rounded-full bg-card-2 py-1.5 text-[12px] font-medium text-ink-2 transition hover:text-ink" onClick={() => setAmount(p.value)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <dl className="space-y-1.5 rounded-2xl bg-card-2 p-3.5 text-[13px]">
        <Row label="You receive" value={out ? (side === "buy" ? `${formatTokens(out)} ${symbol}` : `${formatEth(out, 6)} ETH`) : "–"} strong />
        <Row label="Fee to X accounts + protocol" value={fee ? `${formatEth(fee, 6)} ETH` : "–"} />
        {refund ? <Row label="Refund (curve sells out)" value={`${formatEth(refund, 6)} ETH`} /> : null}
        <div className="flex items-center justify-between gap-3 pt-1">
          <dt className="text-ink-2">Slippage</dt>
          <dd className="segmented p-0.5">
            {SLIPPAGES.map((s) => (
              <button key={s.toString()} data-active={slippage === s} onClick={() => setSlippage(s)} className="!px-2 !py-0.5 !text-[11px]">
                {Number(s) / 100}%
              </button>
            ))}
          </dd>
        </div>
      </dl>

      <button
        className={`w-full py-3.5 ${side === "buy" ? "btn-buy" : "btn-sell"}`}
        disabled={isConnected && (busy || !parsed || !out || insufficient || noGasLeft)}
        onClick={() => guard(trade)}
      >
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
        <p role="status" className={`animate-pop text-center text-[13px] font-medium ${msg.kind === "ok" ? "text-up-ink" : "text-down-ink"}`}>
          {msg.text}
        </p>
      ) : null}
      {dialog}
      <p className="text-center text-[11px] text-ink-3">{graduated ? "Trading in the PonSwap pool · liquidity locked forever" : "Trading on the bonding curve"}</p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className={`num ${strong ? "font-semibold text-ink" : "text-ink-2"}`}>{value}</dd>
    </div>
  );
}
