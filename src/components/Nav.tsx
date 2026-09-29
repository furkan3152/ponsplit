"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useSwitchChain } from "wagmi";
import { useNetwork, useSwitchNetwork } from "@/lib/network-context";
import { NETWORK_IDS, NETWORKS } from "@/lib/networks";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./art";
import { SearchBox } from "./SearchBox";

/**
 * The top bar: search in the middle, the network switch, the wallet and the Launch button on the
 * right. On phones it carries the logo (the sidebar is desktop only; the tab bar takes over).
 */
export function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-[var(--glass)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <Link href="/" className="group shrink-0 lg:hidden" aria-label="SplitEarn home">
          <Wordmark textClassName="hidden min-[440px]:inline" />
        </Link>
        <SearchBox className="hidden flex-1 md:block lg:mx-auto lg:max-w-[560px]" />
        <div className="ml-auto flex min-w-0 items-center gap-2 lg:ml-0">
          <SearchBox className="md:hidden" compact />
          <NetworkSwitch />
          <ThemeToggle compact className="hidden xl:inline-flex" />
          <WalletButton />
          <Link href="/create" className="btn-primary hidden shrink-0 px-5 py-2 text-[14px] md:inline-flex">
            Launch
          </Link>
        </div>
      </div>
    </header>
  );
}

/**
 * Mainnet / Testnet, always at the top of the page. Picking one reloads the whole site on it:
 * coins, balances, launches and claims all belong to the network shown here.
 */
function NetworkSwitch() {
  const n = useNetwork();
  const switchTo = useSwitchNetwork();
  // Mainnet only (testnet is on just for the fork tests): nothing to switch between.
  if (NETWORK_IDS.length < 2) return null;
  return (
    <div role="radiogroup" aria-label="Network" className="segmented shrink-0 !p-0.5">
      {NETWORK_IDS.map((id) => {
        const active = n.id === id;
        const test = NETWORKS[id].isTestnet;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active}
            onClick={() => !active && switchTo(id)}
            title={test ? "Robinhood Chain testnet: free test ETH, coins have no value" : "Robinhood Chain mainnet, on the real Pons"}
            className="inline-flex items-center gap-1.5 !px-2.5 !py-1.5 font-mono !text-[11px] uppercase tracking-[0.08em] sm:!px-3"
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? (test ? "bg-sun" : "animate-pulse-dot bg-lime") : "bg-line-2"}`}
            />
            {/* one word: the button's flex gap would otherwise split "Main" and "net" */}
            <span>
              {test ? "Test" : "Main"}
              <span className="hidden lg:inline">net</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WalletButton() {
  const n = useNetwork();
  const { switchChain } = useSwitchChain();
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openConnectModal, mounted }) => {
        if (!mounted) return <div className="h-9 w-20 sm:w-28" aria-hidden />;
        if (!account) {
          return (
            <button className="btn-neon shrink-0 px-4 py-2 text-[13px]" onClick={openConnectModal}>
              Connect
            </button>
          );
        }
        // The wallet is on the other network (or an unrelated chain): transactions switch it anyway,
        // but say so up front.
        if (chain?.id !== n.chain.id) {
          return (
            <button className="btn-sell shrink-0 px-3 py-2 text-[12px] sm:px-4 sm:text-[13px]" onClick={() => switchChain({ chainId: n.chain.id })}>
              Use {n.label}
            </button>
          );
        }
        return (
          <button className="btn-secondary min-w-0 gap-2 px-3 py-1.5 text-[13px]" onClick={openAccountModal}>
            <span className="h-2 w-2 shrink-0 animate-pulse-dot rounded-full bg-lime" aria-hidden />
            <span className="num truncate">{account.displayName}</span>
            {account.displayBalance ? <span className="hidden text-ink-2 lg:inline">{account.displayBalance}</span> : null}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
