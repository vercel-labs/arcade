import { createProxy } from '@vercel/geistdocs/proxy';
import { NextResponse } from 'next/server';
import { config as geistdocsConfig } from '@/lib/geistdocs/config';

// Rewrites `/` to the `[lang]`-routed `/en` (hidden from the URL per `hideLocale:
// 'default-locale'` in lib/geistdocs/i18n.ts). Without this, every route under
// app/[lang]/** only resolves at its literal /en path — the bare root 404s.
// `install` is excluded because it's a top-level route (app/install/route.ts,
// outside [lang]) — the i18n rewrite would otherwise send it looking for a
// nonexistent app/[lang]/install/route.ts instead.
const proxy = createProxy({
  config: geistdocsConfig,
  // The site uses hand-authored, framework-independent agent documents instead
  // of mirroring every React page into MDX. Content negotiation still points
  // agents at useful Markdown while humans receive the full visual experience.
  before: ({ request }) => {
    if (!request.headers.get('accept')?.includes('text/markdown')) return;
    const pathname = request.nextUrl.pathname;
    const target = pathname === '/'
      ? '/agent-content/home'
      : pathname.startsWith('/docs') || ['/about', '/privacy', '/contact'].includes(pathname)
        ? '/agent-content/docs'
        : '/agent-content/not-found';

    const response = NextResponse.rewrite(new URL(target, request.url));
    return response;
  },
});

export const config = {
  matcher: [
    '/((?!api(?:/|$)|agent-content(?:/|$)|install(?:\\.sh)?(?:/|$)|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|opengraph-image|llms(?:-full)?\\.txt|agents\\.md|examples\\.json|openapi\\.json|schemas(?:/|$)).*)',
  ],
};

export default proxy;
