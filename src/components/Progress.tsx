/** Bonding progress: a neon bar (with a travelling sheen when large); solid green once the coin graduated. */
export function Progress({ value, graduated, size = "md" }: { value: number; graduated?: boolean; size?: "sm" | "md" }) {
  const v = graduated ? 100 : Math.min(100, Math.max(0, value));
  const h = size === "sm" ? "h-1.5" : "h-3";
  return (
    <div role="progressbar" aria-valuenow={Math.floor(v)} aria-valuemin={0} aria-valuemax={100} className={`${h} w-full overflow-hidden rounded-full bg-card-3`}>
      <div
        className={`relative h-full overflow-hidden rounded-full transition-[width] duration-700 ease-out ${graduated ? "bg-up" : "bg-lime"}`}
        style={{ width: `${Math.max(v, v > 0 ? 3 : 0)}%`, boxShadow: graduated ? undefined : "0 0 14px var(--glow)" }}
      >
        {!graduated && v > 0 && size === "md" ? (
          <span
            aria-hidden
            className="absolute inset-0 animate-shimmer bg-[length:200%_100%]"
            style={{ backgroundImage: "linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.6) 50%, transparent 70%)" }}
          />
        ) : null}
      </div>
    </div>
  );
}
