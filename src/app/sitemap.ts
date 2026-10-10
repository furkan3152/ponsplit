import type { MetadataRoute } from "next";

const base = process.env.SITE_URL || "https://www.tiksplit.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/create", "/claim", "/how", "/docs", "/privacy", "/terms"].map((path) => ({ url: `${base}${path}`, changeFrequency: "daily", priority: path ? 0.6 : 1 }));
}
