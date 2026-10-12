import { LAUNCH_FEE_LAMPORTS, PLATFORM_BPS } from "@/lib/solana/config";

const pct = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 3 })}%`;
/** pump.fun's bonding curve fees (its fee config on mainnet, October 2026). */
const CURVE_PROTOCOL = 0.95;
const CURVE_CREATOR = 0.3;

/** The fee table: what a curve trade pays and where every part goes. */
export function FeeTable() {
  const splidev = PLATFORM_BPS / 100;
  const devs = 100 - splidev;
  const rows: { part: string; ofTrade: string; to: string; strong?: boolean }[] = [
    { part: "pump.fun fee", ofTrade: pct(CURVE_PROTOCOL + CURVE_CREATOR), to: "Every buy and sell on the bonding curve", strong: true },
    { part: "↳ pump.fun", ofTrade: pct(CURVE_PROTOCOL), to: "Kept by pump.fun" },
    { part: "↳ creator fee", ofTrade: pct(CURVE_CREATOR), to: "Shared through pump.fun's fee sharing, set for good at launch" },
    { part: "   ↳ GitHub devs", ofTrade: pct((CURVE_CREATOR * devs) / 100), to: `${devs}% of the creator fee, by the shares set at launch`, strong: true },
    { part: "   ↳ Splitdev", ofTrade: pct((CURVE_CREATOR * splidev) / 100), to: `${splidev}% of the creator fee` },
    { part: "after graduating", ofTrade: "0.05–0.95%", to: "pump.fun's pool sets the creator fee by market cap; same split", strong: true },
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

/** A worked example on a 1 SOL trade. */
export function FeeExample() {
  const splidev = PLATFORM_BPS / 100;
  const s = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 5 })} SOL`;
  return (
    <p className="text-[15px] leading-relaxed text-ink-2">
      Someone buys for <span className="num text-ink">1 SOL</span> on the curve: the trade pays <span className="num text-ink">{s(0.0125)}</span> in fees.{" "}
      <span className="num text-ink">{s(0.0095)}</span> goes to pump.fun, <span className="num text-ink">{s((0.003 * (100 - splidev)) / 100)}</span> to the coin&apos;s
      GitHub developers and <span className="num text-ink">{s((0.003 * splidev) / 100)}</span> to Splitdev.
    </p>
  );
}

/** Splitdev's launch fee. */
export function LaunchFee() {
  return <span className="num text-ink">{(Number(LAUNCH_FEE_LAMPORTS) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 9 })} SOL</span>;
}
