import { ImageResponse } from "next/og";
import { LOGO_DATA_URL } from "@/lib/logo-svg";

export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: Tiksplit's split-play mark. */
export default function AppleIcon() {
  const logo = LOGO_DATA_URL;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0b0c0f" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={132} height={132} alt="" />
      </div>
    ),
    size
  );
}
