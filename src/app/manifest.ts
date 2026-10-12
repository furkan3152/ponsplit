import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Splitdev",
    short_name: "Splitdev",
    description: "pump.fun coins whose trading fees pay GitHub developers, on Solana.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d0a1a",
    theme_color: "#0d0a1a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
