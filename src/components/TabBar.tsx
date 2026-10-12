"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClaimIcon, ExploreIcon, HomeIcon, LaunchIcon, WalletIcon } from "./icons";
import { isActive } from "./Sidebar";

const TABS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/explore", label: "Explore", Icon: ExploreIcon },
  { href: "/create", label: "Launch", Icon: LaunchIcon },
  { href: "/claim", label: "Claim", Icon: ClaimIcon },
  { href: "/me", label: "Portfolio", Icon: WalletIcon },
];

/** A floating tab bar on phones and tablets; the sidebar takes over from `lg` up. */
export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 rounded-full border border-line-2 bg-[var(--glass)] p-1.5 shadow-[0_24px_48px_-20px_rgba(0,0,0,0.75)] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
    >
      <div className="grid grid-cols-5 gap-1">
        {TABS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 rounded-full pb-1.5 pt-2 text-[10px] font-semibold transition duration-300 ${
                active ? "bg-lime text-[var(--lime-ink)] shadow-[0_8px_24px_-10px_var(--glow)]" : "text-ink-2 active:scale-95"
              }`}
            >
              <Icon size={21} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
