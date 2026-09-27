import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "PonSplit: one coin, many X accounts, fees split";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  const hero = readFileSync(join(process.cwd(), "public", "hero.svg"));
  const logo = readFileSync(join(process.cwd(), "public", "logo.svg"));
  const src = (buf: Buffer) => `data:image/svg+xml;base64,${buf.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#f5f5f7", padding: 64, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 560 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src(logo)} width={64} height={64} alt="" />
            <span style={{ fontSize: 40, fontWeight: 700, color: "#1d1d1f" }}>PonSplit</span>
          </div>
          <div style={{ fontSize: 68, fontWeight: 800, color: "#1d1d1f", lineHeight: 1.05, marginTop: 36, letterSpacing: -2 }}>One coin. Many X accounts. Fees, split.</div>
          <div style={{ fontSize: 28, color: "#6e6e73", marginTop: 24 }}>Launch on Robinhood Chain</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src(hero)} width={560} height={360} alt="" />
      </div>
    ),
    size
  );
}
