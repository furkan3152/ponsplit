// Line icons for the app shell (24px grid, 1.8 stroke), drawn to match the sticker art's rounded joins.
const base = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

type P = { className?: string; size?: number };
const svg = (children: React.ReactNode) =>
  function Icon({ className, size = 22 }: P) {
    return (
      <svg {...base} width={size} height={size} className={className} aria-hidden>
        {children}
      </svg>
    );
  };

export const HomeIcon = svg(
  <>
    <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19z" />
  </>
);
export const ExploreIcon = svg(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m15.4 8.6-2 4.8-4.8 2 2-4.8z" />
  </>
);
export const LaunchIcon = svg(
  <>
    <path d="M13.5 17.5 10 14l-3.5-.5 2-3.5c3-4.5 7-6 11-6 0 4-1.5 8-6 11z" />
    <path d="M10 14l-4.5 4.5M7 21c-1.5 0-3-.5-3-3" />
    <circle cx="15" cy="9" r="1.4" />
  </>
);
export const ClaimIcon = svg(
  <>
    <ellipse cx="12" cy="6.5" rx="7" ry="3" />
    <path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
    <path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
  </>
);
export const WalletIcon = svg(
  <>
    <rect x="3" y="6" width="18" height="14" rx="3" />
    <path d="M16 13h2M3 10h18M7 6V4.5h10V6" />
  </>
);
export const DocsIcon = svg(
  <>
    <path d="M6 3.5h8.5L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1-1.5z" />
    <path d="M14 3.5V8h5M8.5 12.5h7M8.5 16h5" />
  </>
);
export const ShieldIcon = svg(
  <>
    <path d="M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </>
);
export const SearchIcon = svg(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </>
);
export const CollapseIcon = svg(<path d="m11 7-5 5 5 5M18 7l-5 5 5 5" />);
export const BookIcon = svg(
  <>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
    <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
    <path d="M8.5 7.5h7M8.5 11h5" />
  </>
);
export const ArrowIcon = svg(<path d="M5 12h14M13 6l6 6-6 6" />);
export const SparkIcon = svg(<path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z" />);

/** The X (Twitter) logo, filled. */
export function XLogo({ className, size = 18 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
