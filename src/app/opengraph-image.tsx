import { ImageResponse } from "next/og";
import { LOGO_DATA_URL } from "@/lib/logo-svg";

export const runtime = "nodejs";
export const alt = "Tiksplit: creator coins for TikTok on Solana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", backgroundColor: "#0b0e11", padding: 64, alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexDirection: "column", width: 750 }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 40, fontWeight: 700, color: "#f4f7f8", letterSpacing: -2 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URL} width={40} height={40} alt="" style={{ marginRight: 12 }} />
          tik<span style={{ color: "#41e7dd" }}>split</span><span style={{ color: "#ff6b80" }}>.</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 74, fontWeight: 800, color: "#f4f7f8", lineHeight: 1.04, marginTop: 44, letterSpacing: -3 }}><span>Turn attention into</span><span style={{ color: "#41e7dd" }}>creator earnings.</span></div>
        <div style={{ fontSize: 24, color: "#abb6c0", marginTop: 36 }}>TikTok creators · pump.fun · Solana mainnet</div>
      </div>
      <div style={{ width: 250, height: 320, border: "1px solid #29343e", borderRadius: 28, background: "#12171c", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_DATA_URL} width={190} height={190} alt="" />
      </div>
    </div>,
    size,
  );
}
