import type { Metadata } from "next";
import { coinView } from "@/lib/solana/server";

export async function generateMetadata({ params }: { params: { address: string } }): Promise<Metadata> {
  const t = await coinView(params.address).catch(() => null);
  if (!t) return { title: "Coin" };
  const who = t.recipients.map((r) => r.login ?? `#${r.githubId}`).join(", ");
  const description = (t.description ?? "").trim().slice(0, 300) || `Every trade of $${t.symbol} pays ${who} on GitHub.`;
  const title = `${t.name} ($${t.symbol})`;
  return {
    title,
    description,
    openGraph: { title: `${title} on Splidev`, description },
    twitter: { card: "summary_large_image", title: `${title} on Splidev`, description },
  };
}

export default function TokenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
