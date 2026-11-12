import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/layout";
import { source } from "@/lib/source";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({ url: `${siteUrl}${page.url}` }));
}
