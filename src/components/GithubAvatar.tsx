"use client";

import { useState } from "react";
import { githubAvatarById } from "@/lib/github-handles";
import { TokenSticker } from "./art";

/**
 * A GitHub account's avatar, by its permanent numeric id (a renamed account keeps its picture), or
 * the generated sticker when it fails to load.
 */
export function GithubAvatar({ id, login, size = 28, className = "" }: { id?: string; login?: string; size?: number; className?: string }) {
  const url = id ? githubAvatarById(id, Math.min(460, size * 2)) : login ? `https://github.com/${login}.png?size=${Math.min(460, size * 2)}` : undefined;
  const [failedUrl, setFailedUrl] = useState<string>();
  if (!url || failedUrl === url) return <TokenSticker seed={`gh:${id ?? login}`} size={size} className={`shrink-0 rounded-full ring-2 ring-card ${className}`} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={login ? `@${login}` : ""}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailedUrl(url)}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-full bg-card-2 object-cover ring-2 ring-card ${className}`}
    />
  );
}

/** Overlapping avatar stack, like a group chat; it fans out a little when its card is hovered. */
export function GithubAvatarStack({ people, size = 22, max = 4 }: { people: readonly { githubId: string; login?: string }[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  return (
    <div className="flex items-center">
      {shown.map((p, i) => (
        <GithubAvatar
          key={p.githubId}
          id={p.githubId}
          login={p.login}
          size={size}
          className={i ? "-ml-1.5 transition-[margin] duration-300 group-hover:-ml-0.5" : ""}
        />
      ))}
      {people.length > max ? <span className="chip -ml-1 font-mono !text-[10.5px] ring-2 ring-card">+{people.length - max}</span> : null}
    </div>
  );
}
