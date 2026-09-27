"use client";

import { useState } from "react";

export function TokenAvatar({ src, symbol, size = 48 }: { src?: string; symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (!src || failed) {
    return (
      <div style={style} className="grid shrink-0 place-items-center rounded-xl bg-ink-700 font-mono text-sm text-lime">
        {symbol.slice(0, 3).toUpperCase()}
      </div>
    );
  }
  return (
    // Token images are arbitrary user-supplied URLs, so next/image's domain allowlist does not fit.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={symbol} style={style} onError={() => setFailed(true)} className="shrink-0 rounded-xl bg-ink-700 object-cover" />
  );
}
