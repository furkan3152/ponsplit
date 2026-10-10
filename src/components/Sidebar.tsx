"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { formatSol, shortAddress } from "@/lib/format";
import { useSolBalance } from "@/lib/hooks";
import { SIDEBAR_KEY } from "@/lib/theme";
import { isTikTokLaunchReady } from "@/lib/tiktok-config";
import { LogoMark, WordmarkText } from "./art/Logo";
import { BookIcon, ClaimIcon, CollapseIcon, DocsIcon, ExploreIcon, HomeIcon, LaunchIcon, WalletIcon } from "./icons";

export const NAV = [
  { href: "/", label: "Overview", Icon: HomeIcon },
  { href: "/explore", label: "Explore coins", Icon: ExploreIcon },
  { href: "/create", label: "Launch a coin", Icon: LaunchIcon },
  { href: "/claim", label: "Creator earnings", Icon: ClaimIcon },
  { href: "/me", label: "My portfolio", Icon: WalletIcon },
  { href: "/how", label: "How it works", Icon: DocsIcon },
  { href: "/docs", label: "Documentation", Icon: BookIcon },
] as const;

export const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

export function Sidebar() {
  const pathname = usePathname();
  const [folded, setFolded] = useState(false);
  useEffect(() => setFolded(document.documentElement.getAttribute("data-sidebar") === "folded"), []);
  const toggle = () => {
    const next = !folded;
    setFolded(next);
    if (next) document.documentElement.setAttribute("data-sidebar", "folded");
    else document.documentElement.removeAttribute("data-sidebar");
    try { localStorage.setItem(SIDEBAR_KEY, next ? "folded" : "open"); } catch { /* Keep this session's preference. */ }
  };

  return (
    <aside aria-label="Sidebar" className="sidebar fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-paper lg:flex">
      <div className="flex h-[76px] items-center px-5">
        <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="Tiksplit home">
          <LogoMark size={32} className="shrink-0" /><WordmarkText className="sidebar-label text-[24px]" />
        </Link>
        <button type="button" onClick={toggle} aria-label={folded ? "Expand sidebar" : "Collapse sidebar"} className="absolute -right-3 top-6 grid h-6 w-6 place-items-center rounded-md border border-line-2 bg-card text-ink-3 hover:text-ink"><CollapseIcon size={12} className={folded ? "rotate-180" : ""} /></button>
      </div>
      <div className="sidebar-label px-6 pb-3 pt-5 text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-3">Creator hub</div>
      <nav className="flex flex-col gap-1 px-3">
        {NAV.map(({ href, label, Icon }, index) => {
          const active = isActive(pathname, href);
          return (
            <Link key={href} href={href} title={label} aria-current={active ? "page" : undefined} className={`relative flex items-center gap-3 rounded-lg px-3 py-3 text-[13px] font-medium transition ${index === 5 ? "mt-5" : ""} ${active ? "bg-lime-soft text-lime" : "text-ink-2 hover:bg-card hover:text-ink"}`}>
              <Icon size={19} className="shrink-0" /><span className="sidebar-label truncate">{label}</span>
              {active ? <span aria-hidden className="sidebar-label ml-auto h-1 w-1 rounded-full bg-lime" /> : null}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto p-3">
        <div className="sidebar-label mb-4 border-t border-line px-2 pt-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-2"><span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />Solana mainnet</div>
          <div className="mt-1.5 text-[11px] text-ink-3">{isTikTokLaunchReady() ? "pump.fun creator coins" : "Launch setup in progress"}</div>
        </div>
        <SidebarAccount />
      </div>
    </aside>
  );
}

function SidebarAccount() {
  const { publicKey, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const balance = useSolBalance();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-14" aria-hidden />;
  const address = connected && publicKey ? publicKey.toBase58() : null;
  return (
    <button type="button" onClick={() => (address ? void disconnect() : setVisible(true))} title={address ? "Disconnect wallet" : "Connect wallet"} className="sidebar-account flex w-full items-center gap-2.5 rounded-lg border border-line bg-card p-3 text-left transition hover:border-line-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-card-2 text-lime"><WalletIcon size={17} /></span>
      <span className="sidebar-label min-w-0"><span className="block truncate text-[12px] font-semibold">{address ? shortAddress(address) : "Connect wallet"}</span><span className="mt-0.5 block truncate text-[10px] text-ink-3">{address ? balance.data !== undefined ? `${formatSol(balance.data, 3)} SOL` : "Solana wallet" : "Your place in the creator economy"}</span></span>
    </button>
  );
}
