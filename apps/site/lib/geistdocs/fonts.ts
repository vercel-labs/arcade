import { GeistSans } from 'geist/font/sans';
import { Geist_Mono as createMono } from 'next/font/google';

// Geist Sans is loaded from the `geist` npm package (local woff2), which hardcodes
// the `--font-geist-sans` variable; aliased to `--font-sans` in globals.css.
export const sans = GeistSans;

export const mono = createMono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: 'variable',
  display: 'swap',
});
