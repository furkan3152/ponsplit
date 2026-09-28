import type { Metadata } from "next";
import { visitorNetworkId } from "@/lib/server-network";
import { fetchCoin } from "@/lib/server-token";

export async function generateMetadata({ params }: { params: { address: string } }): Promise<Metadata> {
  const found = await fetchCoin(params.address, visitorNetworkId());
  if (!found) return { title: "Coin" };
  const { coin: t, description: about, network } = found;
  // Launch-time usernames (the fees follow the account ids), so written without "@".
  const who = t.handles.join(", ");
  const description = about.trim().slice(0, 300) || `Every trade of $${t.symbol} pays ${who}.`;
  const title = `${t.name} ($${t.symbol})${network.isTestnet ? " · testnet" : ""}`;
  return {
    title,
    description,
    openGraph: { title: `${title} on SplitEarn`, description },
    twitter: { card: "summary_large_image", title: `${title} on SplitEarn`, description },
  };
}

export default function TokenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
