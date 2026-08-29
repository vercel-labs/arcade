import '../global.css';
import '@/lib/geistdocs/site-url-warning';
import { Footer } from '@vercel/geistdocs/footer';
import type { Metadata } from 'next';
import { GeistdocsProvider } from '@/components/geistdocs/provider';
import { QuickTerminalProvider } from '@/components/quick-terminal';
import { SiteNav } from '@/components/site-nav';
import { config } from '@/lib/geistdocs/config';
import { mono, pixel, sans } from '@/lib/geistdocs/fonts';
import { i18n } from '@/lib/geistdocs/i18n';
import { getRootLang } from '@/lib/geistdocs/root-params';
import { isSiteUrlConfigured, siteUrl } from '@/lib/geistdocs/site-url';
import { cn } from '@/lib/utils';

export const generateStaticParams = () => i18n.languages.map((lang) => ({ lang }));

export const metadata: Metadata = {
  metadataBase: isSiteUrlConfigured ? siteUrl : undefined,
  applicationName: 'Arcade',
  title: { default: 'Arcade — 3D games in your terminal', template: '%s — Arcade' },
  description: 'A pure-TypeScript CPU 3D renderer, retained TUI, and agent-playable game harness.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Arcade',
    title: 'Arcade — 3D games in your terminal',
    description: 'Build and play CPU-rendered 3D ASCII games in terminals and browsers.',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'Arcade — 3D games in your terminal' }],
  },
};

const Layout = async ({ children }: LayoutProps<'/[lang]'>) => {
  const lang = await getRootLang();

  return (
    <html className={cn(sans.variable, mono.variable, pixel.variable, 'antialiased')} lang={lang} suppressHydrationWarning>
      <body>
        <GeistdocsProvider basePath={config.basePath} lang={lang}>
          <QuickTerminalProvider>
            <SiteNav />
            {children}
            <Footer />
          </QuickTerminalProvider>
        </GeistdocsProvider>
      </body>
    </html>
  );
};

export default Layout;
