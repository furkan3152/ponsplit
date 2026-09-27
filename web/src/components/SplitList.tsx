import { pct } from "@/lib/format";

export function SplitList({ handles, bps, compact }: { handles: readonly string[]; bps: readonly number[]; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {handles.map((h, i) => (
          <span key={h} className="rounded-md bg-ink-700 px-1.5 py-0.5 font-mono text-[11px] text-white/80">
            @{h} <span className="text-lime">{pct(bps[i])}</span>
          </span>
        ))}
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {handles.map((h, i) => (
        <li key={h} className="flex items-center gap-3">
          <a href={`https://x.com/${h}`} target="_blank" rel="noreferrer" className="font-mono text-sm hover:text-lime">
            @{h}
          </a>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-700">
            <div className="h-full bg-lime/80" style={{ width: `${Number(bps[i]) / 100}%` }} />
          </div>
          <span className="w-14 text-right font-mono text-sm text-lime">{pct(bps[i])}</span>
        </li>
      ))}
    </ul>
  );
}
