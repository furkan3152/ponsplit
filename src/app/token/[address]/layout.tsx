import type { Metadata } from "next";
import { coinView } from "@/lib/solana/server";

export async function generateMetadata({ params }: { params: { address: string } }): Promise<Metadata> {
  const t = await coinView(params.address).catch(() => null);
  if (!t) return { title: "Coin" };
  const who = t.recipients.map((r) => `@${r.handle}`).join(", ");
  const description = (t.description ?? "").trim().slice(0, 300) || `Creator fees from $${t.symbol} support ${who} on TikTok.`;
  const title = `${t.name} ($${t.symbol})`;
  return {
    title,
    description,
    openGraph: { title: `${title} on Tiksplit`, description },
    twitter: { card: "summary_large_image", title: `${title} on Tiksplit`, description },
  };
}

export default function TokenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
