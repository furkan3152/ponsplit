"use client";

import { useState } from "react";
import { TokenSticker } from "./art";

/** The token's image, or its generated sticker when there is none (or it fails to load). */
export function TokenAvatar({ src, seed, size = 48, className = "" }: { src?: string; seed: string; size?: number; className?: string }) {
  // Remembers which URL failed, so a new URL (e.g. while typing one in) gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string>();
  if (!src || failedSrc === src) return <TokenSticker seed={seed} size={size} className={`shrink-0 ${className}`} />;
  return (
    // User-supplied URLs, so next/image's domain allowlist does not fit.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setFailedSrc(src)}
      style={{ width: size, height: size, borderRadius: size * 0.28 }}
      className={`shrink-0 bg-card-2 object-cover ${className}`}
    />
  );
}
