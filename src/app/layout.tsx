import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Figtree, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { Sidebar } from "@/components/Sidebar";
import { TabBar } from "@/components/TabBar";
import { Ticker } from "@/components/Ticker";
import { THEME_SCRIPT } from "@/lib/theme";
import { Providers } from "./providers";
import "./globals.css";

// Clear geometric headlines, readable body copy and tabular on-chain values.
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });
const sans = Figtree({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const editorial = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-editorial" });

/** The public URL, for absolute links in share cards: explicit, else the host's production URL. */
function siteUrl(): string {
  if (process.env.SITE_URL) return process.env.SITE_URL;
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Tiksplit · Creator coins for TikTok", template: "%s · Tiksplit" },
  description: "Launch creator coins on Solana with pump.fun. TikTok creators prove ownership with a public code video, receive manual approval and claim escrow fees in SOL.",
};

// No themeColor here: Next re-renders its own theme-color tag on every navigation, which would
// undo the light theme's color. THEME_SCRIPT (src/lib/theme.ts) adds and owns that tag instead.
export const viewport: Viewport = {};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${display.variable} ${sans.variable} ${mono.variable} ${editorial.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <Providers>
          <Sidebar />
          <div className="shell">
            <Nav />
            <Ticker />
            <main className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-6 sm:px-6 lg:pb-16">{children}</main>
            <Footer />
          </div>
          <TabBar />
        </Providers>
      </body>
    </html>
  );
}
