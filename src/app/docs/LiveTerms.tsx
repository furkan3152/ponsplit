"use client";

import { formatEther } from "viem";
import { useLaunchTerms } from "@/lib/hooks";

const pct = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 3 })}%`;

/** pons's fee and SplitEarn's share, as the live launcher reports them (20% until they load). */
function useShares() {
  const { data } = useLaunchTerms();
  const splitEarn = (data?.platformShareBps ?? 2000) / 100;
  return { terms: data, splitEarn, accounts: 100 - splitEarn };
}

/** The fee table: what each trade pays and where every part goes, read from the live contracts. */
export function FeeTable() {
  const { splitEarn, accounts } = useShares();
  const creator = 0.7;
  const rows: { part: string; ofTrade: string; to: string; strong?: boolean }[] = [
    { part: "pons fee", ofTrade: pct(1), to: "Every buy and sell, on the curve and in the pool", strong: true },
    { part: "↳ pons", ofTrade: pct(0.3), to: "30% of the fee, kept by pons" },
    { part: "↳ creator fee", ofTrade: pct(creator), to: "70% of the fee, paid to the coin's SplitEarn splitter" },
    { part: "   ↳ X accounts", ofTrade: pct((creator * accounts) / 100), to: `${accounts}% of the creator fee, by the shares set at launch`, strong: true },
    { part: "   ↳ SplitEarn", ofTrade: pct((creator * splitEarn) / 100), to: `${splitEarn}% of the creator fee` },
    { part: "creator tax", ofTrade: "0–10%", to: "Optional, chosen at launch: 100% to the X accounts", strong: true },
  ];
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-left text-[14px]">
        <thead>
          <tr className="border-b border-line font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            <th className="px-4 py-3 font-medium">Part</th>
            <th className="px-4 py-3 font-medium">Of each trade</th>
            <th className="hidden px-4 py-3 font-medium sm:table-cell">Where it goes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.part}>
              <td className={`whitespace-pre px-4 py-3 font-mono text-[13px] ${r.strong ? "text-ink" : "text-ink-2"}`}>{r.part}</td>
              <td className={`num px-4 py-3 ${r.strong ? "font-semibold text-ink" : "text-ink-2"}`}>
                {r.ofTrade}
                <span className="mt-0.5 block text-[12px] font-normal text-ink-3 sm:hidden">{r.to}</span>
              </td>
              <td className="hidden px-4 py-3 text-ink-2 sm:table-cell">{r.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A worked example on a 1 ETH trade. */
export function FeeExample() {
  const { accounts, splitEarn } = useShares();
  const eth = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 5 })} ETH`;
  return (
    <p className="text-[15px] leading-relaxed text-ink-2">
      Someone buys for <span className="num text-ink">1 ETH</span> on a coin with no creator tax: the trade pays{" "}
      <span className="num text-ink">{eth(0.01)}</span> in fees. <span className="num text-ink">{eth(0.003)}</span> goes to pons,{" "}
      <span className="num text-ink">{eth((0.007 * accounts) / 100)}</span> to the coin&apos;s X accounts and{" "}
      <span className="num text-ink">{eth((0.007 * splitEarn) / 100)}</span> to SplitEarn. With a 5% creator tax the accounts also get{" "}
      <span className="num text-ink">{eth(0.05)}</span>.
    </p>
  );
}

/** pons's launch fee, live. */
export function LaunchFee() {
  const { terms } = useShares();
  return <span className="num text-ink">{terms ? `${formatEther(terms.ponsLaunchFee)} ETH` : "a small fee in ETH"}</span>;
}
