"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useNetwork } from "@/lib/network-context";
import { SIDEBAR_KEY } from "@/lib/theme";
import { useAdminSession } from "@/lib/useAdmin";
import { LogoMark, TokenSticker } from "./art";
import { ClaimIcon, CollapseIcon, DocsIcon, ExploreIcon, HomeIcon, LaunchIcon, ShieldIcon, WalletIcon, XLogo } from "./icons";
import { X_HANDLE, X_URL } from "@/lib/brand";

export const NAV = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/explore", label: "Explore", Icon: ExploreIcon },
  { href: "/create", label: "Launch", Icon: LaunchIcon },
  { href: "/claim", label: "Claim", Icon: ClaimIcon },
  { href: "/me", label: "Portfolio", Icon: WalletIcon },
  { href: "/how", label: "How it works", Icon: DocsIcon },
] as const;

export const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

/**
 * The desktop sidebar (lg and up): the brand, the pages, and the connected wallet at the bottom.
 * It folds to icons; the choice is remembered and restored before paint (THEME_SCRIPT).
 * Setup appears only for a signed-in admin.
 */
export function Sidebar() {
  const pathname = usePathname();
  const admin = useAdminSession();
  const [folded, setFolded] = useState(false);
  useEffect(() => setFolded(document.documentElement.getAttribute("data-sidebar") === "folded"), []);
  const toggle = () => {
    const next = !folded;
    setFolded(next);
    if (next) document.documentElement.setAttribute("data-sidebar", "folded");
    else document.documentElement.removeAttribute("data-sidebar");
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "folded" : "open");
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
  };
  const items = admin?.admin ? [...NAV, { href: "/setup", label: "Setup", Icon: ShieldIcon }] : NAV;

  return (
    <aside
      aria-label="Sidebar"
      className="sidebar fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-[var(--glass)] backdrop-blur-xl lg:flex"
    >
      <div className="flex h-16 items-center gap-2 px-4">
        <Link href="/" className="group flex min-w-0 items-center gap-2.5" aria-label="SplitEarn home">
          <LogoMark size={34} className="shrink-0 transition-transform duration-500 group-hover:-rotate-12" />
          <span className="sidebar-label display truncate text-[20px] leading-none">
            Split<span className="text-neon">Earn</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-label={folded ? "Open the sidebar" : "Fold the sidebar"}
          className="absolute -right-4 top-4 grid h-8 w-8 place-items-center rounded-full border border-line-2 bg-paper text-ink-3 transition hover:text-ink"
        >
          <CollapseIcon size={15} className={folded ? "rotate-180" : ""} />
        </button>
      </div>

      <nav className="mt-4 flex flex-col gap-1 px-3">
        {items.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-current={active ? "page" : undefined}
              className={`group/nav relative flex items-center gap-3.5 rounded-2xl px-3 py-2.5 text-[16px] font-medium transition ${
                active ? "bg-card-2 text-ink" : "text-ink-2 hover:bg-card hover:text-ink"
              }`}
            >
              {active ? <span className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-lime shadow-[0_0_14px_var(--glow)]" aria-hidden /> : null}
              <Icon className="shrink-0 transition-transform duration-300 group-hover/nav:scale-110" />
              <span className="sidebar-label truncate">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-2 p-3">
        <a
          href={X_URL}
          target="_blank"
          rel="noreferrer"
          title={`@${X_HANDLE} on X`}
          className="group/x flex items-center gap-3.5 rounded-2xl px-3 py-2 text-[14px] font-medium text-ink-2 transition hover:bg-card hover:text-ink"
        >
          <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-ink text-paper transition-transform duration-300 group-hover/x:-rotate-12">
            <XLogo size={11} />
          </span>
          <span className="sidebar-label truncate">@{X_HANDLE}</span>
        </a>
        <SidebarAccount />
      </div>
    </aside>
  );
}

/** The wallet card at the foot of the sidebar, like a signed-in profile. */
function SidebarAccount() {
  const n = useNetwork();
  return (
    <ConnectButton.Custom>
      {({ account, openAccountModal, openConnectModal, mounted }) => {
        if (!mounted) return <div className="h-14" aria-hidden />;
        return (
          <button
            type="button"
            onClick={account ? openAccountModal : openConnectModal}
            className="flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-2.5 text-left transition hover:border-line-2"
          >
            {account ? (
              <TokenSticker seed={`wallet:${account.address}`} size={36} className="shrink-0 rounded-full" />
            ) : (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-lime text-[var(--lime-ink)]">
                <WalletIcon size={18} />
              </span>
            )}
            <span className="sidebar-label min-w-0">
              <span className="block truncate text-[14px] font-semibold">{account ? account.displayName : "Connect wallet"}</span>
              <span className="block truncate font-mono text-[11px] text-ink-3">{account ? n.chain.name : "to launch, trade and claim"}</span>
            </span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
