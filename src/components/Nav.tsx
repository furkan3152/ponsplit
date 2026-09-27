"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeChain } from "@/lib/chains";
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
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="shrink-0" aria-label="PonSplit home">
          <Wordmark />
        </Link>
        <div className="flex-1 sm:hidden" />
        <nav className="no-scrollbar ml-6 hidden flex-1 items-center gap-0.5 overflow-x-auto sm:flex">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition ${
                  active ? "bg-card-2 text-ink" : "text-ink-2 hover:text-ink"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <WalletButton />
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
            <button className="btn-primary px-4 py-2 text-[13px]" onClick={openConnectModal}>
              Connect
            </button>
          );
        }
        if (chain?.unsupported) {
          return (
            <button className="btn bg-down px-4 py-2 text-[13px] text-white" onClick={openChainModal}>
              Switch to {activeChain.name.replace("Robinhood Chain", "Robinhood")}
            </button>
          );
        }
        return (
          <button className="btn-secondary gap-2 px-3 py-1.5 text-[13px]" onClick={openAccountModal}>
            <span className="h-2 w-2 rounded-full bg-up" aria-hidden />
            <span className="num">{account.displayName}</span>
            {account.displayBalance ? <span className="hidden text-ink-2 sm:inline">{account.displayBalance}</span> : null}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
