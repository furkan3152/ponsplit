"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { formatEther, formatUnits, parseEther, parseUnits, type Address } from "viem";
import { useAccount, useBalance, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { launchpadAbi, splitTokenAbi } from "@/lib/abi";
import { activeChain } from "@/lib/chains";
import { LAUNCHPAD_ADDRESS } from "@/lib/config";
import { errorMessage, formatEth, formatTokens } from "@/lib/format";

const SLIPPAGE_BPS = 200n; // 2%

function parse(v: string, decimals: number): bigint | undefined {
  try {
    const n = decimals === 18 ? parseEther(v.trim()) : parseUnits(v.trim(), decimals);
    return n > 0n ? n : undefined;
  } catch {
    return undefined;
  }
}

export function TradePanel({ token, symbol, onTraded }: { token: Address; symbol: string; onTraded: () => void }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { writeContractAsync } = useWriteContract();

  const { data: ethBalance, refetch: refetchEth } = useBalance({ address, chainId: activeChain.id });
  const { data: tokenBalance, refetch: refetchToken } = useReadContract({
    address: token,
    abi: splitTokenAbi,
    chainId: activeChain.id,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const parsed = parse(amount, 18);
  const { data: buyQuote } = useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    chainId: activeChain.id,
    functionName: "quoteBuy",
    args: parsed ? [token, parsed] : undefined,
    query: { enabled: side === "buy" && Boolean(parsed && LAUNCHPAD_ADDRESS) },
  });
  const { data: sellQuote } = useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    chainId: activeChain.id,
    functionName: "quoteSell",
    args: parsed ? [token, parsed] : undefined,
    query: { enabled: side === "sell" && Boolean(parsed && LAUNCHPAD_ADDRESS) },
  });

  const out = side === "buy" ? buyQuote?.[0] : sellQuote?.[0];
  const fee = side === "buy" ? buyQuote?.[1] : sellQuote?.[1];
  const refund = side === "buy" ? buyQuote?.[2] : 0n;
  const insufficient =
    parsed !== undefined &&
    (side === "buy" ? ethBalance !== undefined && parsed > ethBalance.value : tokenBalance !== undefined && parsed > tokenBalance);

  const presets =
    side === "buy"
      ? ["0.01", "0.05", "0.1", "0.5"].map((v) => ({ label: `${v} Ξ`, value: v }))
      : [25, 50, 75, 100].map((p) => ({
          label: `${p}%`,
          value: tokenBalance ? formatUnits((tokenBalance * BigInt(p)) / 100n, 18) : "",
        }));

  async function trade() {
    setMsg(null);
    if (!isConnected) return openConnectModal?.();
    if (!LAUNCHPAD_ADDRESS || !publicClient || !parsed || !out) return;
    setBusy(true);
    try {
      const min = (out * (10_000n - SLIPPAGE_BPS)) / 10_000n;
      const hash =
        side === "buy"
          ? await writeContractAsync({
              address: LAUNCHPAD_ADDRESS,
              abi: launchpadAbi,
              chainId: activeChain.id,
              functionName: "buy",
              args: [token, min],
              value: parsed,
            })
          : await writeContractAsync({
              address: LAUNCHPAD_ADDRESS,
              abi: launchpadAbi,
              chainId: activeChain.id,
              functionName: "sell",
              args: [token, parsed, min],
            });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      setMsg({ kind: "ok", text: side === "buy" ? `Bought ${formatTokens(out)} ${symbol}` : `Sold for ${formatEth(out)} ETH` });
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
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink-800 p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setAmount("");
              setMsg(null);
            }}
            className={`rounded-lg py-2 text-sm font-semibold capitalize transition ${
              side === s ? (s === "buy" ? "bg-lime text-ink" : "bg-red-400 text-ink") : "text-mute hover:text-white"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div>
        <div className="mb-1.5 flex justify-between text-xs text-mute">
          <span>{side === "buy" ? "You pay" : "You sell"}</span>
          {isConnected ? (
            <span className="font-mono">
              bal{" "}
              {side === "buy"
                ? `${ethBalance ? formatEth(ethBalance.value) : "–"} ETH`
                : `${tokenBalance !== undefined ? formatTokens(tokenBalance) : "–"} ${symbol}`}
            </span>
          ) : null}
        </div>
        <div className="relative">
          <input
            className="input pr-20 font-mono text-lg"
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(",", "."))}
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-mute">
            {side === "buy" ? "ETH" : symbol}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {presets.map((p) => (
            <button key={p.label} className="rounded-lg bg-ink-800 py-1 font-mono text-xs text-mute hover:text-white" onClick={() => setAmount(p.value)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1 rounded-xl bg-ink-800 p-3 font-mono text-xs text-mute">
        <Row label="You receive" value={out ? (side === "buy" ? `${formatTokens(out)} ${symbol}` : `${formatEth(out, 6)} ETH`) : "–"} strong />
        <Row label="Fee (split to X accounts + protocol)" value={fee ? `${formatEth(fee, 6)} ETH` : "–"} />
        {refund ? <Row label="Refund (curve sells out)" value={`${formatEther(refund)} ETH`} /> : null}
        <Row label="Max slippage" value={`${Number(SLIPPAGE_BPS) / 100}%`} />
      </div>

      <button
        className={`w-full py-3 ${side === "buy" ? "btn-primary" : "btn bg-red-400 text-ink hover:bg-red-300"}`}
        disabled={isConnected && (busy || !parsed || !out || insufficient)}
        onClick={trade}
      >
        {!isConnected ? "Connect wallet" : busy ? "Confirming…" : insufficient ? "Insufficient balance" : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
      </button>
      {msg ? <p className={`text-sm ${msg.kind === "ok" ? "text-lime" : "text-red-300"}`}>{msg.text}</p> : null}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className={strong ? "text-white" : ""}>{value}</span>
    </div>
  );
}
