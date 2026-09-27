import type { Metadata } from "next";
import { parseMetadata } from "@/lib/metadata";
import { fetchToken } from "@/lib/server-token";

export async function generateMetadata({ params }: { params: { address: string } }): Promise<Metadata> {
  const t = await fetchToken(params.address);
  if (!t) return { title: "Coin" };
  const who = t.handles.map((h) => `@${h}`).join(", ");
  const description = parseMetadata(t.metadata).description || `Every trade of $${t.symbol} splits its fees between ${who}.`;
  return {
    title: `${t.name} ($${t.symbol})`,
    description,
    openGraph: { title: `${t.name} ($${t.symbol}) on PonSplit`, description },
    twitter: { card: "summary_large_image", title: `${t.name} ($${t.symbol}) on PonSplit`, description },
  };
}

export default function TokenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
