import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Why Arcade exists',
  description: 'Why Arcade uses games, terminal cells, and shared rules to make model behavior visible, playful, and open to exploration.',
  alternates: { canonical: '/docs/motivation' },
};

export default function AboutPage() {
  redirect('/docs/motivation');
}
