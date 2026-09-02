import type { Metadata } from 'next';
import { InfoPage } from '@/components/info-page';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'Arcade browser, CLI, authentication, telemetry, and local trace privacy boundaries.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return <InfoPage eyebrow="Privacy" title="Local by default, explicit at the boundary.">
    <p>The homepage terminal starts a temporary isolated Linux session and connects your browser to its PTY. Files and processes in that session are discarded when it expires. The visitor shell never receives the site&apos;s AI Gateway credential: model requests use a scoped network transformation, and general shell network access is denied.</p>
    <p>Hosted terminal telemetry is disabled. Arcade&apos;s existing telemetry policy still applies to local installations, where it can be disabled with <code>ARCADE_TELEMETRY=0</code> or the in-app setting. Browser-safe rendering primitives run locally in the browser.</p>
    <h2>CLI authentication</h2>
    <p>The full terminal Arcade can use Vercel device authentication to obtain a team-scoped AI Gateway key. The selected account information is stored in the user's Arcade configuration directory with restricted permissions; the minted Gateway key is re-derived rather than committed to the repository. Browser-safe packages cannot import authentication, filesystem, terminal, or telemetry modules.</p>
    <h2>Telemetry and traces</h2>
    <p>Arcade telemetry records anonymous usage and canonical game records. It does not send prompts, private reasoning, table chat, voice, credentials, or Vercel account identity. Telemetry can be disabled with <code>ARCADE_TELEMETRY=0</code>, the CLI telemetry command, or the home-menu setting. Match-lab disables telemetry by default and writes persistent test traces only to the local run directory, which is gitignored. Review the implementation and schemas in the <a href="https://github.com/vercel-labs/arcade">source repository</a>.</p>
  </InfoPage>;
}
