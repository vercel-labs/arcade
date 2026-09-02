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
  openGraph: {
    type: 'website',
    title: 'arcade',
    description: 'The 3D game engine built for agents.',
    images: [{ url: '/opengraph-image.png', width: 1200, height: 630, alt: 'Arcade — the 3D game engine built for agents' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'arcade',
    description: 'The 3D game engine built for agents.',
    images: ['/opengraph-image.png'],
  },
};

const HomePage = () => <main className="living-title-page">
  <script dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} type="application/ld+json" />
  <Hero />
</main>;

export default HomePage;
