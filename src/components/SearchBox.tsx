"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { isAddress } from "viem";
import { coinImage } from "@/lib/coin-ui";
import { compact } from "@/lib/format";
import { useCoins } from "@/lib/hooks";
import { SearchIcon } from "./icons";
import { TokenAvatar } from "./TokenAvatar";

/**
 * Search across every coin on the network: name, $ticker, @account or address. Shows the best
 * matches as you type; Enter opens the full results on Explore. "/" focuses it from anywhere.
 * `compact` is the phone version: an icon that opens the field over the top bar.
 */
export function SearchBox({ className = "", compact: small = false }: { className?: string; compact?: boolean }) {
  const router = useRouter();
  const { data: coins } = useCoins();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (small) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [small]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setExpanded(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^[@$]/, "");
    if (!s) return [];
    return (coins ?? [])
      .filter((t) => t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s) || t.token.toLowerCase() === s || t.handles.some((h) => h.includes(s)))
      .sort((a, b) => b.marketCap - a.marketCap)
      .slice(0, 6);
  }, [coins, q]);

  const go = () => {
    const s = q.trim();
    setOpen(false);
    setExpanded(false);
    if (isAddress(s)) router.push(`/token/${s}`);
    else router.push(s ? `/explore?q=${encodeURIComponent(s)}` : "/explore");
  };

  if (small && !expanded) {
    return (
      <button
        type="button"
        aria-label="Search coins"
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line text-ink-2 ${className}`}
        onClick={() => {
          setExpanded(true);
          setTimeout(() => input.current?.focus(), 0);
        }}
      >
        <SearchIcon size={17} />
      </button>
    );
  }

  return (
    <div ref={box} className={small ? "absolute inset-x-3 top-3 z-50" : `relative ${className}`}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        className="flex h-10 items-center gap-2.5 rounded-full border border-line bg-card px-4 transition focus-within:border-line-2 focus-within:ring-4 focus-within:ring-[var(--lime-soft)]"
      >
        <SearchIcon size={17} className="shrink-0 text-ink-3" />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && (setOpen(false), setExpanded(false))}
          placeholder="Search coins, $tickers, @accounts"
          aria-label="Search coins"
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-3"
        />
        {small ? null : <kbd className="hidden rounded-md border border-line px-1.5 font-mono text-[11px] text-ink-3 sm:inline">/</kbd>}
      </form>
      {open && q.trim() ? (
        <div className="absolute inset-x-0 top-12 z-50 overflow-hidden rounded-2xl border border-line-2 bg-card shadow-lift">
          {matches.length ? (
            matches.map((t) => (
              <Link
                key={t.token}
                href={`/token/${t.token}`}
                onClick={() => {
                  setOpen(false);
                  setExpanded(false);
                }}
                className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-card-2"
              >
                <TokenAvatar src={coinImage(t)} seed={t.token} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{t.name}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-3">
                    ${t.symbol} · {t.handles.map((h) => `@${h}`).join(" ")}
                  </span>
                </span>
                <span className="num text-[12px] text-ink-2">{compact(t.marketCap)} Ξ</span>
              </Link>
            ))
          ) : (
            <div className="px-4 py-3 text-[13px] text-ink-3">No coin matches “{q.trim()}”.</div>
          )}
          <button type="button" onClick={go} className="block w-full border-t border-line px-4 py-2.5 text-left text-[13px] font-medium text-ink-2 hover:bg-card-2">
            See all results on Explore →
          </button>
        </div>
      ) : null}
    </div>
  );
}
