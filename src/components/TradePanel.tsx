"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, type Connection } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { errorMessage, formatSol, formatTokens } from "@/lib/format";
import { useSolBalance, useTokenBalance } from "@/lib/hooks";
import { buyTransaction, quoteBuy, quoteSell, sellTransaction } from "@/lib/solana/pump";
import type { Coin } from "@/lib/types";
import { useRiskGate } from "./RiskNotice";

const SLIPPAGES = [100, 200, 500, 1000]; // bps
/** SOL kept back for network fees and new token accounts when buying with "Balance". */
const FEE_RESERVE = 10_000_000n;

function parseAmount(v: string, decimals: number): bigint | undefined {
  const t = v.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return undefined;
  const [i, f = ""] = t.split(".");
  if (f.length > decimals) return undefined;
  const n = BigInt(i || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  return n > 0n ? n : undefined;
}
const toText = (raw: bigint, decimals: number) => {
  const s = raw.toString().padStart(decimals + 1, "0");
  const i = s.slice(0, -decimals);
  const f = s.slice(-decimals).replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
};

/**
 * Buys and sells a coin where it trades right now: on its pump.fun bonding curve, then on
 * pump.fun's pool once it has graduated. pump.fun's fees apply as on pump.fun itself; the
 * creator's part goes to its TikTok escrow, platform and optional launcher.
 */
export function TradePanel({ coin, onTraded }: { coin: Coin; onTraded: () => void }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(200);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const lock = useRef(false);

  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const { guard, dialog } = useRiskGate();
  const sol = useSolBalance();
  const tokens = useTokenBalance(coin.token);
  const mint = new PublicKey(coin.token);

  const parsed = parseAmount(amount, side === "buy" ? 9 : 6);
  const quote = useQuery({
    queryKey: ["quote", coin.token, side, parsed?.toString()],
    enabled: Boolean(parsed),
    refetchInterval: 5_000,
    queryFn: () => (side === "buy" ? quoteBuy(connection, mint, parsed!) : quoteSell(connection, mint, parsed!)),
  });

  const balance = side === "buy" ? sol.data : tokens.data;
  // A buy is "these tokens for at most this much SOL": with the slippage allowance the wallet may pay
  // up to `maxPay`, so balance checks use that, not the typed amount.
  const maxPay = side === "buy" && parsed !== undefined ? (parsed * BigInt(10_000 + slippage)) / 10_000n : undefined;
  const spend = side === "buy" ? maxPay : parsed;
  const insufficient = spend !== undefined && balance !== undefined && spend > balance;
  const noFeesLeft = side === "buy" && !insufficient && spend !== undefined && balance !== undefined && spend + FEE_RESERVE > balance;

  const presets =
    side === "buy"
      ? ["0.1", "0.5", "1", "5"].map((v) => ({ label: `${v} SOL`, value: v }))
      : [25, 50, 75, 100].map((p) => ({ label: p === 100 ? "Max" : `${p}%`, value: tokens.data ? toText((tokens.data * BigInt(p)) / 100n, 6) : "" }));

  async function trade() {
    setMsg(null);
    if (!connected || !publicKey) return setVisible(true);
    if (!parsed || lock.current) return;
    lock.current = true;
    const seen = quote.data;
    try {
      setBusy("Checking the price…");
      // Built on the chain's current state; the slippage setting bounds the price against that.
      const built = side === "buy" ? await buyTransaction(connection, publicKey, mint, parsed, slippage) : await sellTransaction(connection, publicKey, mint, parsed, slippage);
      // ...and against the quote the visitor saw: if the price moved past their slippage since, stop
      // and show the new quote instead of sending a worse trade than the one on screen.
      const now = "tokens" in built ? built.tokens : built.lamports;
      if (seen !== undefined && now * 10_000n < seen * BigInt(10_000 - slippage)) {
        void quote.refetch();
        throw new Error(`The price moved: you'd now get about ${"tokens" in built ? `${formatTokens(now)} ${coin.symbol}` : `${formatSol(now, 6)} SOL`}. Check the new quote and try again.`);
      }
      setBusy("Confirm in your wallet…");
      const sig = await sendTransaction(built.tx, connection, { maxRetries: 3 });
      setBusy("Confirming…");
      await confirmSignature(connection, sig);
      setMsg({
        kind: "ok",
        text: side === "buy" ? `Bought about ${formatTokens("tokens" in built ? built.tokens : 0n)} ${coin.symbol}` : `Sold for about ${formatSol("lamports" in built ? built.lamports : 0n)} SOL`,
      });
      setAmount("");
      void sol.refetch();
      void tokens.refetch();
      onTraded();
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(null);
      lock.current = false;
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
          {connected ? (
            <button
              className="num -mr-2 min-w-0 truncate rounded-full px-2 py-1 text-[11px] text-ink-2 transition hover:bg-card-2 hover:text-ink"
              onClick={() => {
                if (balance === undefined) return;
                // A buy may cost up to the slippage allowance more, so "Balance" leaves room for it.
                const usable = side === "buy" ? (balance > FEE_RESERVE ? ((balance - FEE_RESERVE) * 10_000n) / BigInt(10_000 + slippage) : 0n) : balance;
                setAmount(usable > 0n ? toText(usable, side === "buy" ? 9 : 6) : "");
              }}
            >
              Balance {side === "buy" ? `${sol.data !== undefined ? formatSol(sol.data) : "–"} SOL` : `${tokens.data !== undefined ? formatTokens(tokens.data) : "–"} ${coin.symbol}`}
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
            aria-label={side === "buy" ? "SOL amount" : `${coin.symbol} amount`}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(",", "."))}
          />
          <span className="pointer-events-none inline-flex max-w-[45%] shrink-0 items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1.5 font-mono text-[12px] font-semibold text-ink">
            {buying ? (
              <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-ink text-[9px] font-bold leading-none text-paper">
                ◎
              </span>
            ) : null}
            <span className="truncate">{buying ? "SOL" : coin.symbol}</span>
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
            value={quote.data ? (buying ? `${formatTokens(quote.data)} ${coin.symbol}` : `${formatSol(quote.data, 6)} SOL`) : parsed && quote.isFetching ? "…" : "–"}
            strong
          />
          <Row
            label="pump.fun fees"
            value="included"
            className="!mt-2.5 border-t border-dashed border-line pt-2.5"
          />
          {buying && maxPay !== undefined ? <Row label="You pay at most" value={`${formatSol(maxPay, 6)} SOL`} /> : null}
          <Row label="Creator fee goes to" value={`@${coin.recipients[0]?.handle ?? "creator"} escrow + Tiksplit${coin.launcherBps ? " + launcher" : ""}`} />
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
        className={`w-full !py-4 text-[16px] ${!connected ? "btn-neon" : buying ? "btn-buy" : "btn-sell"}`}
        disabled={connected && (Boolean(busy) || !parsed || !quote.data || insufficient || noFeesLeft)}
        onClick={() => guard(trade)}
      >
        {busy ? <Spinner /> : null}
        {!connected
          ? "Connect wallet"
          : busy
            ? busy
            : insufficient
              ? "Insufficient balance"
              : noFeesLeft
                ? "Leave a little SOL for fees"
                : `${buying ? "Buy" : "Sell"} ${coin.symbol}`}
      </button>
      {msg ? <Status msg={msg} /> : null}
      {dialog}
      <p className="text-center font-mono text-[10.5px] leading-relaxed text-ink-3">
        <span aria-hidden className={`mr-2 inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full align-middle ${coin.graduated ? "bg-up" : "bg-lime"}`} />
        {coin.graduated ? "Trading on pump.fun's pool" : "Trading on the pump.fun bonding curve"}
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

/** Waits for a signature by polling its status, so a dropped websocket doesn't fail a trade that landed. */
async function confirmSignature(connection: Connection, sig: string) {
  for (let k = 0; k < 50; k++) {
    const st = (await connection.getSignatureStatuses([sig]).catch(() => null))?.value[0];
    if (st?.err) throw new Error("The transaction failed on chain.");
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error("The network was slow to confirm. Check your wallet before trying again.");
}
