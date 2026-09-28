import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";
import { compact, curveProgress, formatEth, pct, spotPrice } from "@/lib/format";
import { parseMetadata } from "@/lib/metadata";
import { fetchImageDataUrl } from "@/lib/safe-image";
import { fetchToken } from "@/lib/server-token";

export const runtime = "nodejs";
export const alt = "Coin on PonSplit";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COLORS = ["#d7ff3c", "#7cc7ff", "#ff9bc2", "#ffd84d", "#b69cff", "#ff9f45"];

/** The card shows live numbers, so it must not be cached as immutable (Next's default for OG images). */
const LIVE = { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" };
/** "Not found" is often a transient RPC failure. */
const MISS = { "Cache-Control": "no-store" };

export default async function TokenOgImage({ params }: { params: { address: string } }) {
  const t = await fetchToken(params.address);
  const logo = `data:image/svg+xml;base64,${readFileSync(join(process.cwd(), "public", "logo.svg")).toString("base64")}`;

  if (!t) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f5f7", fontSize: 64, fontWeight: 800, color: "#1d1d1f", gap: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={96} height={96} alt="" />
          PonSplit
        </div>
      ),
      { ...size, headers: MISS }
    );
  }

  const meta = parseMetadata(t.metadata);
  const image = meta.image ? await fetchImageDataUrl(meta.image) : null;
  const price = spotPrice(t.market.virtualEth, t.market.virtualToken);
  const mcap = price * (Number(t.totalSupply) / 1e18);
  const progress = curveProgress(t.market.realToken, t.curveSupply, t.market.graduated);
  const initials = t.symbol.slice(0, 3).toUpperCase();

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#f5f5f7", padding: 60, color: "#1d1d1f" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 700 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={48} height={48} alt="" />
          PonSplit
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
              {`@${h} · ${pct(t.bps[i])}`}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 48, marginTop: "auto", fontSize: 30, color: "#6e6e73" }}>
          <div style={{ display: "flex" }}>
            mcap<b style={{ color: "#1d1d1f", marginLeft: 10 }}>{compact(mcap)} ETH</b>
          </div>
          <div style={{ display: "flex" }}>
            split so far<b style={{ color: "#1d1d1f", marginLeft: 10 }}>{formatEth(t.creatorFees, 4)} ETH</b>
          </div>
          <div style={{ display: "flex" }}>
            {t.market.graduated ? <b style={{ color: "#12a150" }}>Graduated</b> : <span>{progress.toFixed(0)}% bonded</span>}
          </div>
        </div>
      </div>
    ),
    { ...size, headers: LIVE }
  );
}
