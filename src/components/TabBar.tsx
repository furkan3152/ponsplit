"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const icon = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const TABS = [
  {
    href: "/",
    label: "Explore",
    svg: (
      <svg {...icon} aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.5-2 5-5 2 2-5z" />
      </svg>
    ),
  },
  {
    href: "/create",
    label: "Launch",
    svg: (
      <svg {...icon} aria-hidden>
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    ),
  },
  {
    href: "/claim",
    label: "Claim",
    svg: (
      <svg {...icon} aria-hidden>
        <ellipse cx="12" cy="7" rx="7" ry="3" />
        <path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7" />
        <path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
      </svg>
    ),
  },
  {
    href: "/me",
    label: "Portfolio",
    svg: (
      <svg {...icon} aria-hidden>
        <rect x="3" y="6" width="18" height="14" rx="3" />
        <path d="M16 13h2M3 10h18M7 6V4.5h10V6" />
      </svg>
    ),
  },
];

/** A floating tab bar on small screens; the header nav takes over from `sm` up. */
export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 rounded-full border border-line-2 bg-[var(--glass)] p-1.5 shadow-[0_24px_48px_-20px_rgba(0,0,0,0.75)] backdrop-blur-xl backdrop-saturate-150 sm:hidden"
    >
      <div className="grid grid-cols-4 gap-1">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 rounded-full pb-1.5 pt-2 text-[10px] font-semibold transition duration-300 ${
                active ? "bg-lime text-[var(--lime-ink)] shadow-[0_8px_24px_-10px_var(--glow)]" : "text-ink-2 active:scale-95"
              }`}
            >
              {t.svg}
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
