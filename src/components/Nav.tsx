"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeChain } from "@/lib/chains";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./art";

const NAV = [
  { href: "/", label: "Explore" },
  { href: "/create", label: "Launch" },
  { href: "/claim", label: "Claim" },
  { href: "/me", label: "Portfolio" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-[var(--glass)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="group shrink-0" aria-label="PonsEarn home">
          <Wordmark />
        </Link>
        <nav className="no-scrollbar ml-6 hidden items-center gap-1 sm:flex">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`relative whitespace-nowrap rounded-full px-3.5 py-2 text-[14px] font-medium transition ${active ? "text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {n.label}
                {active ? <span className="absolute inset-x-3.5 -bottom-[13px] h-[2px] rounded-full bg-lime shadow-[0_0_14px_var(--glow)]" aria-hidden /> : null}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 lg:inline-flex">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-lime" aria-hidden />
            {activeChain.name}
          </span>
          <ThemeToggle compact className="hidden sm:inline-flex" />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        if (!mounted) return <div className="h-9 w-28" aria-hidden />;
        if (!account) {
          return (
            <button className="btn-neon px-4 py-2 text-[13px]" onClick={openConnectModal}>
              Connect
            </button>
          );
        }
        if (chain?.unsupported) {
          return (
            <button className="btn-sell px-4 py-2 text-[13px]" onClick={openChainModal}>
              Switch to {activeChain.name.replace("Robinhood Chain", "Robinhood")}
            </button>
          );
        }
        return (
          <button className="btn-secondary gap-2 px-3 py-1.5 text-[13px]" onClick={openAccountModal}>
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-lime" aria-hidden />
            <span className="num">{account.displayName}</span>
            {account.displayBalance ? <span className="hidden text-ink-2 md:inline">{account.displayBalance}</span> : null}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
