/**
 * JSON for chain data sent from the server to the browser: bigints and Maps survive the trip
 * (`{"$b":"123"}`, `{"$m":[[k,v],…]}`).
 */
export function encode(value: unknown): string {
  return JSON.stringify(value, function (key, v) {
    // JSON.stringify calls toJSON-less Maps with {} by default; look at the raw value instead.
    const raw = (this as Record<string, unknown>)[key];
    if (typeof raw === "bigint") return { $b: raw.toString() };
    if (raw instanceof Map) return { $m: [...raw.entries()] };
    return v;
  });
}

export function decode<T>(text: string): T {
  return JSON.parse(text, (_, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === "$b" && typeof v.$b === "string") return BigInt(v.$b);
      if (keys.length === 1 && keys[0] === "$m" && Array.isArray(v.$m)) return new Map(v.$m);
    }
    return v;
  }) as T;
}
