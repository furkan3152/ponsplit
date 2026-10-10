import { LAUNCH_FEE_LAMPORTS, PLATFORM_BPS } from "@/lib/solana/config";

const pct = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** Shares of creator fees, separate from pump.fun's trading fees. */
export function FeeTable() {
  const platform = PLATFORM_BPS / 100;
  const rows = [
    { part: "Tiksplit", share: pct(platform), to: "Platform treasury; fixed for the coin when its split is finalized" },
    { part: "Launcher", share: "0–10%", to: "Optional share paid to the launcher's wallet" },
    { part: "TikTok creator", share: `${pct(100 - platform)} minus launcher share`, to: "The remainder goes to the selected creator’s escrow account" },
  ];
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-left text-[14px]">
        <caption className="border-b border-line px-4 py-3 text-left text-[13px] text-ink-2">How the coin&apos;s creator fees are shared</caption>
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-[0.12em] text-ink-3">
            <th className="px-4 py-3 font-medium">Recipient</th>
            <th className="px-4 py-3 font-medium">Share</th>
            <th className="hidden px-4 py-3 font-medium sm:table-cell">Destination</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.part}>
              <td className="px-4 py-3 font-semibold text-ink">{row.part}</td>
              <td className="num px-4 py-3 text-ink-2">
                {row.share}
                <span className="mt-1 block font-sans text-[12px] text-ink-3 sm:hidden">{row.to}</span>
              </td>
              <td className="hidden px-4 py-3 text-ink-2 sm:table-cell">{row.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FeeExample() {
  return (
    <p className="text-[14px] leading-relaxed text-ink-2">
      These percentages apply to creator fees, not to the full trade amount. The selected creator receives the remainder after platform and launcher shares.
      pump.fun&apos;s protocol fees are separate and can vary by market and stage; review the current transaction quote before signing.
    </p>
  );
}

export function LaunchFee() {
  return <span className="num text-ink">{(Number(LAUNCH_FEE_LAMPORTS) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 9 })} SOL</span>;
}
