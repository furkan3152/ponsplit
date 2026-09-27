"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeChain } from "@/lib/chains";

const NAV = [
  { href: "/", label: "Explore" },
  { href: "/create", label: "Launch" },
  { href: "/claim", label: "Claim" },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-ink-700/80 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-lime font-mono text-sm text-ink">/</span>
          <span className="hidden sm:inline">PonSplit</span>
        </Link>
        <span className="hidden rounded-full border border-ink-600 px-2 py-0.5 font-mono text-[11px] text-mute md:inline">
          {activeChain.name}
        </span>
        <nav className="ml-auto flex items-center gap-1 sm:ml-6 sm:mr-auto">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${active ? "bg-ink-700 text-white" : "text-mute hover:text-white"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <ConnectButton chainStatus="icon" showBalance={false} accountStatus={{ smallScreen: "avatar", largeScreen: "address" }} />
      </div>
    </header>
  );
}
