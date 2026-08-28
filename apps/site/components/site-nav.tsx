import { LogoIconVercel } from '@vercel/geistdocs/assets/logos/logo-icon-vercel';
import { IconSlashForward } from '@vercel/geistdocs/assets/icons/icon-slash-forward';
import Link from 'next/link';

// A deliberately plain top bar: the standard Vercel triangle (no "OSS" flyout, no
// search box, no Ask AI button — @vercel/geistdocs's own <Navbar> renders those
// last two unconditionally with no config to hide them, and this site has neither
// a search index nor a chat route to back them). Reuses geistdocs' own logo/icon
// assets and design tokens (theme.css) so it still matches the rest of the page.
const NAV_LINKS = [
  { label: 'Docs', href: '/docs' },
  { label: 'Examples', href: '/examples' },
  { label: 'AI Gateway', href: 'https://vercel.com/ai-gateway' },
];

const GitHubIcon = () => (
  <svg aria-hidden="true" height="20" viewBox="0 0 16 16" width="20" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

export const SiteNav = () => (
  <header className="sticky top-0 z-30 border-b bg-background-100/80 backdrop-blur">
    <div className="mx-auto flex h-16 w-full max-w-[1448px] items-center justify-between px-4">
      <Link className="flex items-center gap-2.5 text-gray-1000" href="/">
        <LogoIconVercel size={18} />
        <span className="w-4 text-center text-gray-alpha-400">
          <IconSlashForward size={18} />
        </span>
        <span className="font-mono font-semibold text-lg leading-none tracking-tight">arcade</span>
      </Link>
      <nav className="flex items-center gap-5">
        {NAV_LINKS.map((link) => (
          <Link
            className="text-gray-900 text-sm hover:text-gray-1000"
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
        <a
          aria-label="GitHub repository"
          className="text-gray-900 hover:text-gray-1000"
          href="https://github.com/vercel-labs/arcade"
          rel="noopener noreferrer"
          target="_blank"
        >
          <GitHubIcon />
        </a>
      </nav>
    </div>
  </header>
);
