import { ImageResponse } from "next/og";
import { LOGO_DATA_URL } from "@/lib/logo-svg";
import { compact, formatSol, pct, progressText } from "@/lib/format";
import { safeUrl } from "@/lib/metadata";
import { fetchImageDataUrl } from "@/lib/safe-image";
import { coinView } from "@/lib/solana/server";

export const runtime = "nodejs";
export const alt = "Coin on Tiksplit";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COLORS = ["#41e7dd", "#66c7ff", "#ff8ccf", "#ffd45c", "#a98dff", "#b9ef4f"];

/**
 * The card shows live numbers, so it must not be cached as immutable (Next's default for OG
 * images). The key must be lowercase: Next spreads these over its own "cache-control" default,
 * and a differently-cased key would be appended to it rather than replace it.
 */
const LIVE = { "cache-control": "public, max-age=300, stale-while-revalidate=600" };
/** "Not found" is often a transient RPC failure. */
const MISS = { "cache-control": "no-store" };

export default async function TokenOgImage({ params }: { params: { address: string } }) {
  const t = await coinView(params.address).catch(() => null);
  const logo = LOGO_DATA_URL;

  if (!t) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0b0e11", fontSize: 64, fontWeight: 800, color: "#f4f7f8", gap: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={96} height={96} alt="" />
          Tiksplit
        </div>
      ),
      { ...size, headers: MISS }
    );
  }

  const logoUrl = safeUrl(t.image);
  const coinImage = logoUrl ? await fetchImageDataUrl(logoUrl) : null;
  const initials = t.symbol.slice(0, 3).toUpperCase();

  const card = (image: string | null) => (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0b0e11", padding: 60, color: "#f4f7f8" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 700 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={48} height={48} alt="" />
        Tiksplit
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 36, marginTop: 44 }}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} width={180} height={180} alt="" style={{ borderRadius: 48, border: "5px solid #242e37", objectFit: "cover" }} />
        ) : (
          <div style={{ width: 180, height: 180, borderRadius: 48, border: "5px solid #242e37", background: "#41e7dd", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontWeight: 800, boxShadow: "0 8px 0 #1cb7af", color: "#082523" }}>
            {initials}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: -2, lineHeight: 1 }}>{t.name.slice(0, 22)}</div>
          <div style={{ fontSize: 40, fontWeight: 600, color: "#abb6c0", marginTop: 12 }}>{`$${t.symbol}`}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 40, flexWrap: "wrap" }}>
        {t.recipients.slice(0, 5).map((r, i) => (
          <div key={r.handle} style={{ display: "flex", alignItems: "center", gap: 10, background: "#12171c", border: "3px solid #242e37", borderRadius: 999, padding: "10px 22px", fontSize: 28, fontWeight: 700 }}>
            <div style={{ width: 18, height: 18, borderRadius: 999, background: COLORS[i % COLORS.length], border: "2px solid #130d26" }} />
            {`@${r.handle} · ${pct(r.shareBps)}`}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 48, marginTop: "auto", fontSize: 30, color: "#abb6c0" }}>
        <div style={{ display: "flex" }}>
          mcap<b style={{ color: "#f4f7f8", marginLeft: 10 }}>{compact(t.marketCap)} SOL</b>
        </div>
        <div style={{ display: "flex" }}>
          to split<b style={{ color: "#f4f7f8", marginLeft: 10 }}>{formatSol(t.pendingFees, 4)} SOL</b>
        </div>
        <div style={{ display: "flex" }}>
          {t.graduated ? <b style={{ color: "#3ddc97" }}>Graduated</b> : <span>{progressText(t.progress)}% bonded</span>}
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
