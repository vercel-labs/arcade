import type { Metadata } from 'next';
import { InfoPage } from '@/components/info-page';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'Arcade browser, CLI, authentication, telemetry, and local trace privacy boundaries.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return <InfoPage eyebrow="Privacy" title="Local by default, explicit at the boundary.">
    <p>The playable browser demo runs locally in your browser. It does not request an AI Gateway credential, start a hosted terminal, call a model, or upload game state. Canvas rendering, Chess rules, input, and display-mode changes happen in the page process. The live prism decoration is a read-only stream proxied from the public ASCII prism service.</p>
    <h2>CLI authentication</h2>
    <p>The full terminal Arcade can use Vercel device authentication to obtain a team-scoped AI Gateway key. The selected account information is stored in the user's Arcade configuration directory with restricted permissions; the minted Gateway key is re-derived rather than committed to the repository. Browser-safe packages cannot import authentication, filesystem, terminal, or telemetry modules.</p>
    <h2>Telemetry and traces</h2>
    <p>Arcade telemetry records anonymous usage and canonical game records. It does not send prompts, private reasoning, table chat, voice, credentials, or Vercel account identity. Telemetry can be disabled with <code>ARCADE_TELEMETRY=0</code>, the CLI telemetry command, or the home-menu setting. Match-lab disables telemetry by default and writes persistent test traces only to the local run directory, which is gitignored. Review the implementation and schemas in the <a href="https://github.com/vercel-labs/arcade">source repository</a>.</p>
  </InfoPage>;
}
