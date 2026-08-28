import type { Metadata } from 'next';
import { InfoPage } from '@/components/info-page';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Where to ask questions, report Arcade bugs, and discuss contributions.',
  alternates: { canonical: '/contact' },
};

export default function ContactPage() {
  return <InfoPage eyebrow="Contact and support" title="Build with us in the open.">
    <p>Arcade is developed in the Vercel Labs GitHub organization. For a reproducible bug, documentation gap, browser-host problem, or proposal for a reusable engine or TUI primitive, open an issue in the <a href="https://github.com/vercel-labs/arcade/issues">Arcade issue tracker</a>. Include the operating system, Node version, terminal and color mode when relevant, plus the smallest command or snapshot that reproduces the behavior.</p>
    <h2>Contributions</h2>
    <p>Before proposing a large package split or renderer abstraction, describe the concrete consumer that needs it. Arcade currently favors one package with explicit browser-safe subpaths because that keeps development fast while preserving the import graph. Small examples, tests, accessibility improvements, and fixes that keep the engine independent from the app are especially useful. Never include AI Gateway keys, authentication files, private prompts, or local match traces in an issue or pull request.</p>
    <h2>Security</h2>
    <p>Do not disclose a credential or exploitable vulnerability in a public issue. Use Vercel's official security reporting guidance at <a href="https://vercel.com/security">vercel.com/security</a> for sensitive reports. For ordinary usage questions, the public docs, <a href="/llms.txt">agent index</a>, <a href="/openapi.json">HTTP interface description</a>, and repository history are the canonical sources.</p>
  </InfoPage>;
}
