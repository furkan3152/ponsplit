import type { MetadataRoute } from "next";

const base = process.env.NEXTAUTH_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/create", "/claim", "/how"].map((path) => ({ url: `${base}${path}`, changeFrequency: "daily", priority: path ? 0.6 : 1 }));
}
