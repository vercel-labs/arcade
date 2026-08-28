import Link from 'next/link';
import { InfoPage } from '@/components/info-page';

export default function NotFound() {
  return <InfoPage eyebrow="404 / Not found" title="That Arcade surface does not exist.">
    <p>The requested page is not part of the public site. Start with the <Link href="/docs">developer documentation</Link>, inspect the <a href="/examples.json">machine-readable examples</a>, or read the compact <a href="/llms.txt">agent index</a>. All public pages are listed in <a href="/sitemap.xml">the sitemap</a>.</p>
  </InfoPage>;
}
