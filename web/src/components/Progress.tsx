/** Bonding progress as a chunky sticker bar. */
export function Progress({ value, graduated, size = "md" }: { value: number; graduated?: boolean; size?: "sm" | "md" }) {
  const v = graduated ? 100 : Math.min(100, Math.max(0, value));
  const h = size === "sm" ? "h-2" : "h-3.5";
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`${h} w-full overflow-hidden rounded-full bg-card-2 ${size === "md" ? "border-2 border-outline" : ""}`}
    >
      <div
        className={`h-full rounded-full ${graduated ? "bg-up" : "bg-lime"} ${size === "md" && v > 0 && v < 100 ? "border-r-2 border-outline" : ""}`}
        style={{ width: `${Math.max(v, v > 0 ? 3 : 0)}%` }}
      />
    </div>
  );
}
