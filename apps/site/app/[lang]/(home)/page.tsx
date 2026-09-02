import type { Metadata } from 'next';
import { Hero } from './components/hero';

const structuredData = {
  '@context': 'https://schema.org', '@type': ['SoftwareApplication', 'SoftwareSourceCode'], name: 'Arcade',
  description: 'A pure-TypeScript CPU 3D renderer, retained TUI, and agent-playable game harness.',
  applicationCategory: 'DeveloperApplication', operatingSystem: 'Node.js 22+ and modern browsers',
  isAccessibleForFree: true, codeRepository: 'https://github.com/vercel-labs/arcade',
  programmingLanguage: 'TypeScript', runtimePlatform: 'Node.js and Web browsers', url: 'https://vercel-arcade.vercel.app',
};

export const metadata: Metadata = {
  title: { absolute: 'Arcade — worlds painted in terminal light' },
  description: 'A pure-TypeScript 3D engine for games that live in your terminal.',
  alternates: { canonical: '/' },
  openGraph: { type: 'website', title: 'Arcade — worlds painted in terminal light', description: 'Play CPU-rendered 3D ASCII games with people and frontier AI models.', images: ['/opengraph-image'] },
};

const HomePage = () => <main className="living-title-page">
  <script dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} type="application/ld+json" />
  <Hero />
</main>;

export default HomePage;
