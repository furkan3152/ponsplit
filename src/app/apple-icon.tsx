import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the happy split coin on the app's near-black. */
export default function AppleIcon() {
  const logo = `data:image/svg+xml;base64,${readFileSync(join(process.cwd(), "public", "logo.svg")).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#101013" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={132} height={132} alt="" />
      </div>
    ),
    size
  );
}
