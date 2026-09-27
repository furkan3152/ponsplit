export function Progress({ value, graduated }: { value: number; graduated?: boolean }) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-ink-700">
      <div
        className={`h-full rounded-full transition-all ${graduated ? "bg-gradient-to-r from-lime to-emerald-400" : "bg-lime"}`}
        style={{ width: `${graduated ? 100 : v}%` }}
      />
    </div>
  );
}
