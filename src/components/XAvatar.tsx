"use client";

import { useState } from "react";
import { xAvatarUrl } from "@/lib/handles";
import { TokenSticker } from "./art";

export function XAvatar({ handle, image, size = 28, className = "" }: { handle: string; image?: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <TokenSticker seed={`x:${handle}`} size={size} className={`shrink-0 rounded-full ${className}`} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image || xAvatarUrl(handle)}
      alt={`@${handle}`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-full bg-card-2 object-cover ring-2 ring-card ${className}`}
    />
  );
}

/** Overlapping avatar stack, like a group chat. */
export function XAvatarStack({ handles, size = 22, max = 4 }: { handles: readonly string[]; size?: number; max?: number }) {
  const shown = handles.slice(0, max);
  return (
    <div className="flex items-center">
      {shown.map((h, i) => (
        <XAvatar key={h} handle={h} size={size} className={i ? "-ml-1.5" : ""} />
      ))}
      {handles.length > max ? <span className="chip -ml-1 ring-2 ring-card">+{handles.length - max}</span> : null}
    </div>
  );
}
