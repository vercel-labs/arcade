import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Arcade documentation',
  description: 'Learn how to play, extend, and integrate Arcade.',
  alternates: { canonical: '/docs' },
};

export default function AboutPage() {
  redirect('/docs');
}
