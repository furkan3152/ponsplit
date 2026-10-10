import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tiksplit",
    short_name: "Tiksplit",
    description: "Creator coins for TikTok on Solana with pump.fun.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0c0f",
    theme_color: "#0b0c0f",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
