export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="eyebrow">{label}</div>
      <div className="num mt-1.5 truncate text-[18px] font-semibold tracking-tight" title={hint}>
        {value}
      </div>
    </div>
  );
}
