import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { compact, formatEth, pct, progressText } from "@/lib/format";
import { safeUrl } from "@/lib/metadata";
import { fetchImageDataUrl } from "@/lib/safe-image";
import { DEFAULT_NETWORK } from "@/lib/networks";
import { fetchCoin } from "@/lib/server-token";

export const runtime = "nodejs";
export const alt = "Coin on PonsEarn";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COLORS = ["#d7ff3c", "#7cc7ff", "#ff9bc2", "#ffd84d", "#b69cff", "#ff9f45"];

/**
 * The card shows live numbers, so it must not be cached as immutable (Next's default for OG
 * images). The key must be lowercase: Next spreads these over its own "cache-control" default,
 * and a differently-cased key would be appended to it rather than replace it.
 */
const LIVE = { "cache-control": "public, max-age=300, stale-while-revalidate=600" };
/** "Not found" is often a transient RPC failure. */
const MISS = { "cache-control": "no-store" };

export default async function TokenOgImage({ params }: { params: { address: string } }) {
  // Crawlers carry no cookie: look on the default network first, then the other one.
  const found = await fetchCoin(params.address, DEFAULT_NETWORK);
  const t = found?.coin;
  const logo = `data:image/svg+xml;base64,${readFileSync(join(process.cwd(), "public", "logo.svg")).toString("base64")}`;

  if (!t) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f5f7", fontSize: 64, fontWeight: 800, color: "#1d1d1f", gap: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={96} height={96} alt="" />
          PonsEarn
        </div>
      ),
      { ...size, headers: MISS }
    );
  }

  const logoUrl = safeUrl(t.logo);
  const coinImage = logoUrl ? await fetchImageDataUrl(logoUrl) : null;
  const initials = t.symbol.slice(0, 3).toUpperCase();
  const testnet = found.network.isTestnet;

  const card = (image: string | null) => (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#f5f5f7", padding: 60, color: "#1d1d1f" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 700 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={48} height={48} alt="" />
        PonsEarn
        {testnet ? <span style={{ marginLeft: 12, fontSize: 22, fontWeight: 700, background: "#ffd84d", border: "3px solid #1d1d1f", borderRadius: 999, padding: "4px 14px" }}>TESTNET</span> : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 36, marginTop: 44 }}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} width={180} height={180} alt="" style={{ borderRadius: 48, border: "5px solid #1d1d1f", objectFit: "cover" }} />
        ) : (
          <div style={{ width: 180, height: 180, borderRadius: 48, border: "5px solid #1d1d1f", background: "#d7ff3c", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontWeight: 800, boxShadow: "8px 8px 0 #1d1d1f" }}>
            {initials}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: -2, lineHeight: 1 }}>{t.name.slice(0, 22)}</div>
          <div style={{ fontSize: 40, fontWeight: 600, color: "#6e6e73", marginTop: 12 }}>{`$${t.symbol}`}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 40, flexWrap: "wrap" }}>
        {t.handles.slice(0, 5).map((h, i) => (
          <div key={h} style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "3px solid #1d1d1f", borderRadius: 999, padding: "10px 22px", fontSize: 28, fontWeight: 700 }}>
            <div style={{ width: 18, height: 18, borderRadius: 999, background: COLORS[i % COLORS.length], border: "2px solid #1d1d1f" }} />
            {`${h} · ${pct(t.recipients[i]?.bps ?? 0)}`}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 48, marginTop: "auto", fontSize: 30, color: "#6e6e73" }}>
        <div style={{ display: "flex" }}>
          mcap<b style={{ color: "#1d1d1f", marginLeft: 10 }}>{compact(t.marketCap)} ETH</b>
        </div>
        <div style={{ display: "flex" }}>
          split so far<b style={{ color: "#1d1d1f", marginLeft: 10 }}>{formatEth(t.feesSplit, 4)} ETH</b>
        </div>
        <div style={{ display: "flex" }}>
          {t.graduated ? <b style={{ color: "#12a150" }}>Graduated</b> : <span>{progressText(t.progress)}% bonded</span>}
        </div>
      </div>
    </div>
  );

  if (coinImage) {
    // Render with the coin's image first; if the renderer can't use it, fall back to the initials
    // card rather than failing the whole response (which would leave unfurls without any image).
    try {
      const png = await new ImageResponse(card(coinImage), size).arrayBuffer();
      return new Response(png, { headers: { "content-type": contentType, ...LIVE } });
    } catch {}
  }
  return new ImageResponse(card(null), { ...size, headers: LIVE });
}
