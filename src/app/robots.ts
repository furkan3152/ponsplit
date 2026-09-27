import type { MetadataRoute } from "next";

const base = process.env.NEXTAUTH_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/setup", "/me"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
