import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans, Instrument_Serif, Martian_Mono } from "next/font/google";
import { ConfigBanner } from "@/components/ConfigBanner";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { TabBar } from "@/components/TabBar";
import { Ticker } from "@/components/Ticker";
import { THEME_SCRIPT } from "@/lib/theme";
import { Providers } from "./providers";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", axes: ["wdth", "opsz"] });
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans", axes: ["wdth"] });
const serif = Instrument_Serif({ subsets: ["latin"], variable: "--font-serif", weight: "400", style: ["normal", "italic"] });
const mono = Martian_Mono({ subsets: ["latin"], variable: "--font-mono", axes: ["wdth"] });

/** The public URL, for absolute links in share cards: explicit, else the host's production URL. */
function siteUrl(): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
}

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "PonSplit · One coin, many X accounts", template: "%s · PonSplit" },
  description: "Launch a coin on Robinhood Chain and split its trading fees across any set of X accounts.",
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
      className={`${display.variable} ${sans.variable} ${serif.variable} ${mono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <Providers>
          <Nav />
          <Ticker />
          <ConfigBanner />
          <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pb-24">{children}</main>
          <Footer />
          <TabBar />
        </Providers>
      </body>
    </html>
  );
}
