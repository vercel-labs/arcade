import '../global.css';
import '@/lib/geistdocs/site-url-warning';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata } from 'next';
import { GeistdocsProvider } from '@/components/geistdocs/provider';
import { QuickTerminalProvider } from '@/components/quick-terminal';
import { SiteNav } from '@/components/site-nav';
import { config } from '@/lib/geistdocs/config';
import { mono, pixel, sans } from '@/lib/geistdocs/fonts';
import { i18n } from '@/lib/geistdocs/i18n';
import { getRootLang } from '@/lib/geistdocs/root-params';
import { siteUrl } from '@/lib/geistdocs/site-url';
import { cn } from '@/lib/utils';

export const generateStaticParams = () => i18n.languages.map((lang) => ({ lang }));

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: 'Arcade',
  title: { default: 'Arcade', template: '%s — Arcade' },
  description: 'A pure-TypeScript CPU 3D renderer, retained TUI, and agent-playable game harness.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Arcade',
    title: 'arcade: the 3D game engine for agents',
    description: 'The 3D game engine built for agents.',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'arcade: the 3D game engine for agents' }],
  },
};

const Layout = async ({ children }: LayoutProps<'/[lang]'>) => {
  const lang = await getRootLang();

  return (
    <html className={cn(sans.variable, mono.variable, pixel.variable, 'antialiased dark')} lang={lang} suppressHydrationWarning>
      <body>
        <GeistdocsProvider basePath={config.basePath} lang={lang}>
          <QuickTerminalProvider>
            <SiteNav />
            {children}
          </QuickTerminalProvider>
        </GeistdocsProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
};

export default Layout;
