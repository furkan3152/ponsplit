import { ImageResponse } from "next/og";
import { LOGO_DATA_URL } from "@/lib/logo-svg";
import { CREATOR_REEL_DATA_URL } from "@/lib/creator-reel-svg";

export const runtime = "nodejs";
export const alt = "Tiksplit: make culture, make a coin, share the creator fees";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", backgroundColor: "#0b0c0f", padding: "44px 50px", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexDirection: "column", width: 620 }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 34, fontWeight: 700, color: "#f3f0e8", letterSpacing: -1 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URL} width={32} height={32} alt="" style={{ marginRight: 10 }} />tik<span style={{ color: "#4df3e0" }}>split</span><span style={{ color: "#ff5a75" }}>.</span>
        </div>
        <div style={{ fontSize: 13, color: "#909392", marginTop: 35, letterSpacing: 3, fontFamily: "monospace" }}>THE CREATOR EDITION</div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 66, fontWeight: 800, color: "#f3f0e8", lineHeight: 1.03, marginTop: 18, letterSpacing: -3 }}><span>MAKE CULTURE.</span><span>MAKE A COIN.</span><span style={{ color: "#4df3e0" }}>SHARE THE FEES.</span></div>
        <div style={{ width: 160, height: 3, backgroundColor: "#ff5a75", marginTop: 22 }} />
        <div style={{ fontSize: 18, color: "#b7b6b1", marginTop: 28 }}>TikTok creators / pump.fun / Solana mainnet</div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={CREATOR_REEL_DATA_URL} width={440} height={474} alt="" />
    </div>,
    size,
  );
}
