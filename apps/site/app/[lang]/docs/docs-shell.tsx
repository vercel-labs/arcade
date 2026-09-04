import { GeistdocsDocsLayout } from '@vercel/geistdocs/layout';
import { MobileDocsBar } from '@vercel/geistdocs/mobile-docs-bar';
import type { ReactNode } from 'react';
import { config } from '@/lib/geistdocs/config';
import { DOCS_PAGE_TREE } from './docs-navigation';

export function DocsShell({ children }: { children: ReactNode }) {
  return <GeistdocsDocsLayout config={config} containerProps={{ className: 'arcade-docs-layout' }} tree={DOCS_PAGE_TREE}>
    <div className="arcade-docs-main">
      <MobileDocsBar />
      {children}
    </div>
  </GeistdocsDocsLayout>;
}
