export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="text-[12px] font-medium text-ink-2">{label}</div>
      <div className="num mt-0.5 truncate text-[17px] font-semibold tracking-tight" title={hint}>
        {value}
      </div>
    </div>
  );
}
