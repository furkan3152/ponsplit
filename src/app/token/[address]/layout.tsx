import type { Metadata } from "next";
import { parseMetadata } from "@/lib/metadata";
import { fetchToken } from "@/lib/server-token";

export async function generateMetadata({ params }: { params: { address: string } }): Promise<Metadata> {
  const t = await fetchToken(params.address);
  if (!t) return { title: "Coin" };
  // Launch-time usernames (the fees follow the account ids), so written without "@".
  const who = t.handles.join(", ");
  const description = parseMetadata(t.metadata).description || `Every trade of $${t.symbol} splits its fees between ${who}.`;
  return {
    title: `${t.name} ($${t.symbol})`,
    description,
    openGraph: { title: `${t.name} ($${t.symbol}) on PonsEarn`, description },
    twitter: { card: "summary_large_image", title: `${t.name} ($${t.symbol}) on PonsEarn`, description },
  };
}

export default function TokenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
