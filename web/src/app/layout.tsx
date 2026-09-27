import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Header } from "@/components/Header";
import { ConfigBanner } from "@/components/ConfigBanner";
import { Providers } from "./providers";
import "./globals.css";

const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "PonSplit · Split creator fees on Robinhood Chain",
  description: "Launch a token on Robinhood Chain and split its creator fees across X accounts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans">
        <Providers>
          <Header />
          <ConfigBanner />
          <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
