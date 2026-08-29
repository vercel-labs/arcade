import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { GeistPixelSquare } from 'geist/font/pixel';

// Geist Sans is loaded from the `geist` npm package (local woff2), which hardcodes
// the `--font-geist-sans` variable; aliased to `--font-sans` in globals.css.
export const sans = GeistSans;

export const mono = GeistMono;

// Geist Pixel is deliberately a display face. The site uses it for the Arcade
// wordmark and major headings while prose remains Geist Sans and terminal/code
// surfaces remain Geist Mono.
export const pixel = GeistPixelSquare;
