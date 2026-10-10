import type { MetadataRoute } from "next";

const base = process.env.SITE_URL || "https://www.tiksplit.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/me"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
