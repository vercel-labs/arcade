import type { MetadataRoute } from 'next';

const ORIGIN = 'https://ascii-arcade.dev';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${ORIGIN}/sitemap.xml`,
    host: ORIGIN,
  };
}
