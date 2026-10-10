"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClaimIcon, ExploreIcon, HomeIcon, LaunchIcon, WalletIcon } from "./icons";
import { isActive } from "./Sidebar";

const TABS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/explore", label: "Explore", Icon: ExploreIcon },
  { href: "/create", label: "Launch", Icon: LaunchIcon },
  { href: "/claim", label: "Earnings", Icon: ClaimIcon },
  { href: "/me", label: "Portfolio", Icon: WalletIcon },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-line-2 bg-[var(--glass)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-5 px-2">
        {TABS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`relative flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition ${active ? "text-lime" : "text-ink-3 hover:text-ink"}`}>{active ? <span aria-hidden className="absolute inset-x-5 top-0 h-0.5 bg-lime" /> : null}<Icon size={20} />{label}</Link>;
        })}
      </div>
    </nav>
  );
}
