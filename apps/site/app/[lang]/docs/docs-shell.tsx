'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { DesktopDocsNav, MobileDocsNav } from './docs-client';
import { navigationForPathname, ROOT_DOCS_NAV } from './docs-navigation';

export function DocsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const navigation = navigationForPathname(pathname);
  return <main className="doc-shell mt-(--fd-nav-height)">
    <MobileDocsNav active={navigation.active} items={navigation.items} key={navigation.active} />
    <DesktopDocsNav active={navigation.active} items={navigation.items} rootItems={ROOT_DOCS_NAV} sectionTitle={navigation.sectionTitle} />
    {children}
  </main>;
}
