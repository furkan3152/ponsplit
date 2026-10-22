import type { Metadata } from "next";
import { coinView } from "@/lib/solana/server";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  const t = await coinView(address).catch(() => null);
  if (!t) return { title: "Coin" };
  const who = t.recipients.map((r) => r.login ?? `#${r.githubId}`).join(", ");
  const description = (t.description ?? "").trim().slice(0, 300) || `Every trade of $${t.symbol} pays ${who} on GitHub.`;
  const title = `${t.name} ($${t.symbol})`;
  return {
    title,
    description,
    openGraph: { title: `${title} on Splitdev`, description },
    twitter: { card: "summary_large_image", title: `${title} on Splitdev`, description },
  };
}

export default function TokenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
