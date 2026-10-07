import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Splitdev: pump.fun coins that pay GitHub developers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The share card: the night paper, the wordmark, the line, and a big Bitbug. */
export default function OgImage() {
  const logo = `data:image/svg+xml;base64,${readFileSync(join(process.cwd(), "public", "logo.svg")).toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: "#0d0a1a",
          backgroundImage: "radial-gradient(circle at 12% 0%, #3a1d1c 0%, #0d0a1a 46%)",
          padding: 72,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 640 }}>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: "#f6f1ff", letterSpacing: -2 }}>
            split<span style={{ color: "#ff7a3d" }}>dev</span>
            <span style={{ color: "#ff7a3d" }}>_</span>
          </div>
          <div style={{ fontSize: 76, fontWeight: 800, color: "#f6f1ff", lineHeight: 1.02, marginTop: 40, letterSpacing: -3 }}>Coins that pay GitHub devs.</div>
          <div style={{ fontSize: 28, color: "#b6acd2", marginTop: 28, fontFamily: "monospace" }}>{"// launch on pump.fun · solana"}</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={400} height={436} alt="" />
      </div>
    ),
    size
  );
}
