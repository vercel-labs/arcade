import type { MetadataRoute } from 'next';

const ORIGIN = 'https://vercel-arcade.vercel.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${ORIGIN}/sitemap.xml`,
    host: ORIGIN,
  };
}
