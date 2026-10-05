import { ImageResponse } from "next/og";
import { LOGO_DATA_URL } from "@/lib/logo-svg";
import { compact, formatSol, pct, progressText } from "@/lib/format";
import { safeUrl } from "@/lib/metadata";
import { fetchImageDataUrl } from "@/lib/safe-image";
import { coinView } from "@/lib/solana/server";

export const runtime = "nodejs";
export const alt = "Coin on Splidev";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COLORS = ["#ff7a3d", "#66c7ff", "#ff8ccf", "#ffd45c", "#a98dff", "#b9ef4f"];

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
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0a1a", fontSize: 64, fontWeight: 800, color: "#f6f1ff", gap: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={96} height={96} alt="" />
          Splidev
        </div>
      ),
      { ...size, headers: MISS }
    );
  }

  const logoUrl = safeUrl(t.image);
  const coinImage = logoUrl ? await fetchImageDataUrl(logoUrl) : null;
  const initials = t.symbol.slice(0, 3).toUpperCase();
  const accountsBps = 10_000 - t.platformBps;

  const card = (image: string | null) => (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0d0a1a", padding: 60, color: "#f6f1ff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 700 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={48} height={48} alt="" />
        Splidev
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 36, marginTop: 44 }}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} width={180} height={180} alt="" style={{ borderRadius: 48, border: "5px solid #2a2348", objectFit: "cover" }} />
        ) : (
          <div style={{ width: 180, height: 180, borderRadius: 48, border: "5px solid #2a2348", background: "#ff7a3d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontWeight: 800, boxShadow: "0 8px 0 #c94a14", color: "#1c0c04" }}>
            {initials}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: -2, lineHeight: 1 }}>{t.name.slice(0, 22)}</div>
          <div style={{ fontSize: 40, fontWeight: 600, color: "#b6acd2", marginTop: 12 }}>{`$${t.symbol}`}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 40, flexWrap: "wrap" }}>
        {t.recipients.slice(0, 5).map((r, i) => (
          <div key={r.githubId} style={{ display: "flex", alignItems: "center", gap: 10, background: "#1d1836", border: "3px solid #2a2348", borderRadius: 999, padding: "10px 22px", fontSize: 28, fontWeight: 700 }}>
            <div style={{ width: 18, height: 18, borderRadius: 999, background: COLORS[i % COLORS.length], border: "2px solid #130d26" }} />
            {`${r.login ?? `#${r.githubId}`} · ${pct(Math.round((r.shareBps / accountsBps) * 10_000))}`}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 48, marginTop: "auto", fontSize: 30, color: "#b6acd2" }}>
        <div style={{ display: "flex" }}>
          mcap<b style={{ color: "#f6f1ff", marginLeft: 10 }}>{compact(t.marketCap)} SOL</b>
        </div>
        <div style={{ display: "flex" }}>
          to split<b style={{ color: "#f6f1ff", marginLeft: 10 }}>{formatSol(t.pendingFees, 4)} SOL</b>
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
