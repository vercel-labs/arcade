import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

// Geist Sans is loaded from the `geist` npm package (local woff2), which hardcodes
// the `--font-geist-sans` variable; aliased to `--font-sans` in globals.css.
export const sans = GeistSans;

export const mono = GeistMono;
