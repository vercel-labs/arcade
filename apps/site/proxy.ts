import { createProxy } from '@vercel/geistdocs/proxy';
import { config as geistdocsConfig } from '@/lib/geistdocs/config';

// Rewrites `/` to the `[lang]`-routed `/en` (hidden from the URL per `hideLocale:
// 'default-locale'` in lib/geistdocs/i18n.ts). Without this, every route under
// app/[lang]/** only resolves at its literal /en path — the bare root 404s.
// `install` is excluded because it's a top-level route (app/install/route.ts,
// outside [lang]) — the i18n rewrite would otherwise send it looking for a
// nonexistent app/[lang]/install/route.ts instead.
const proxy = createProxy({ config: geistdocsConfig });

export const config = {
  matcher: [
    '/((?!api(?:/|$)|install(?:\\.sh)?(?:/|$)|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};

export default proxy;
