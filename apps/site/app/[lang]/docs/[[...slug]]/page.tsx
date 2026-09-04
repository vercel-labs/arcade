import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CopyPageButton, DesktopDocsNav, MobileDocsNav, type DocsNavItem } from '../docs-client';
import { APP_DOCS } from '../docs-app';
import { CORE_DOCS, type DocPage } from '../docs-content';
import { GAME_DOCS } from '../docs-games';
import { MOTIVATION_DOC } from '../docs-motivation';
import { GUIDE_DOCS, REFERENCE_DOCS } from '../docs-reference';

const hrefFor = (slug: string) => `/docs${slug ? `/${slug}` : ''}`;
const corePage = (slug: string): DocPage => {
  const page = CORE_DOCS.find((entry) => entry.slug === slug);
  if (!page) throw new Error(`Missing core docs page: ${slug}`);
  return page;
};
const RULES_DOC = corePage('rules');
const COMMUNICATION_DOC = GAME_DOCS.find((page) => page.slug === 'games/communication')!;
const GAME_SECTION_DOCS = [...GAME_DOCS.filter((page) => page !== COMMUNICATION_DOC), RULES_DOC, COMMUNICATION_DOC];
const BROWSER_DOCS = [corePage('web'), corePage('browser-host')];
const DOCS = [
  corePage(''), corePage('getting-started'),
  ...APP_DOCS,
  ...GAME_SECTION_DOCS,
  corePage('engine'), corePage('renderer-pipeline'), corePage('game-visuals'),
  corePage('platform'), corePage('tui'), corePage('components'),
  corePage('game-harness'), corePage('tools'), ...BROWSER_DOCS,
  ...GUIDE_DOCS,
  corePage('package-api'),
  ...REFERENCE_DOCS,
  MOTIVATION_DOC,
];
const findDoc = (slug: string) => DOCS.find((page) => page.slug === slug);
const navItem = (slug: string, drillIn = false): DocsNavItem => {
  const page = corePage(slug);
  return { href: hrefFor(page.slug), label: page.label, ...(drillIn ? { drillIn: true } : {}) };
};
const CORE_NAV: DocsNavItem[] = [
  navItem(''),
  navItem('getting-started'),
  { href: '/docs/app', label: 'Using Arcade', drillIn: true },
  { href: '/docs/games', label: 'Games', drillIn: true },
  navItem('engine'),
  navItem('renderer-pipeline'),
  navItem('game-visuals'),
  navItem('platform'),
  navItem('tui'),
  navItem('components'),
  navItem('game-harness'),
  navItem('tools'),
  navItem('web', true),
  { href: '/docs/guides', label: 'Guides', drillIn: true },
  navItem('package-api'),
  { href: '/docs/reference', label: 'API Reference', drillIn: true },
  { href: '/docs/motivation', label: 'Motivation' },
];
const sectionLabel = (section: string): string => section === 'app' ? 'Using Arcade' : section === 'reference' ? 'API Reference' : section === 'guides' ? 'Guides' : section === 'web' ? 'Browser integration' : 'Games';

export function generateStaticParams() { return DOCS.map((page) => ({ slug: page.slug ? page.slug.split('/') : [] })); }

export async function generateMetadata({ params }: PageProps<'/[lang]/docs/[[...slug]]'>): Promise<Metadata> {
  const { slug = [] } = await params;
  const page = findDoc(slug.join('/'));
  if (!page) return {};
  const canonical = hrefFor(page.slug);
  return { title: page.title, description: page.summary, alternates: { canonical, types: { 'text/markdown': '/llms-full.txt' } }, openGraph: { type: 'article', title: page.title, description: page.summary, url: canonical } };
}

export default async function DocsPage({ params }: PageProps<'/[lang]/docs/[[...slug]]'>) {
  const { slug = [] } = await params;
  const page = findDoc(slug.join('/'));
  if (!page) notFound();
  const activeHref = hrefFor(page.slug);
  const nestedMode = page.slug === 'app' || page.navParent === 'app' ? 'app' : page.slug === 'reference' || page.navParent === 'reference' ? 'reference' : page.slug === 'guides' || page.navParent === 'guides' ? 'guides' : page.slug === 'games' || page.navParent === 'games' ? 'games' : page.slug === 'web' || page.navParent === 'web' ? 'web' : null;
  const navItems = nestedMode === 'app' ? nestedNavItems(APP_DOCS, 'app') : nestedMode === 'reference' ? nestedNavItems(REFERENCE_DOCS, 'reference') : nestedMode === 'guides' ? nestedNavItems(GUIDE_DOCS, 'guides') : nestedMode === 'games' ? nestedNavItems(GAME_SECTION_DOCS, 'games') : nestedMode === 'web' ? nestedNavItems(BROWSER_DOCS, 'web') : CORE_NAV;
  const sectionIds = page.sections.map((section) => slugify(section.heading));
  const index = DOCS.findIndex((entry) => entry.slug === page.slug);
  const previous = index > 0 ? DOCS[index - 1] : null;
  const next = index < DOCS.length - 1 ? DOCS[index + 1] : null;

  return <main className="doc-shell mt-(--fd-nav-height)">
    <MobileDocsNav active={activeHref} items={navItems} />
    <DesktopDocsNav active={activeHref} items={navItems} rootItems={CORE_NAV} sectionTitle={nestedMode ? sectionLabel(nestedMode) : null} />
    <article className="doc-article" data-doc-article>
      <header className="doc-page-header"><nav aria-label="Breadcrumb" className="doc-breadcrumbs"><Link href="/docs">Docs</Link>{page.navParent ? <><span>/</span><Link href={`/docs/${page.navParent}`}>{sectionLabel(page.navParent)}</Link></> : null}{page.slug ? <><span>/</span><span>{page.label}</span></> : null}</nav><h1>{page.title}</h1><p>{page.summary}</p><div className="doc-actions"><CopyPageButton /></div></header>
      {page.body ?? page.sections.map((section, sectionIndex) => { const id = sectionIds[sectionIndex]; return <section id={id} key={section.heading}><h2><a aria-label={`Link to ${section.heading}`} href={`#${id}`}>{section.heading}</a></h2><div>{section.body}</div></section>; })}
      <nav aria-label="Documentation pagination" className="doc-pagination">{previous ? <Link href={hrefFor(previous.slug)}><span>Previous</span><strong>← {previous.label}</strong></Link> : <span />}{next ? <Link href={hrefFor(next.slug)}><span>Next</span><strong>{next.label} →</strong></Link> : <span />}</nav>
    </article>
  </main>;
}

function slugify(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function nestedNavItems(pages: DocPage[], root: string): DocsNavItem[] {
  const items: DocsNavItem[] = [{ href: `/docs/${root}`, label: 'Overview' }];
  let group = '';
  for (const page of pages.filter((entry) => entry.navParent === root)) {
    if (page.navGroup && page.navGroup !== group) { group = page.navGroup; items.push({ href: '', label: '', group }); }
    items.push({ href: hrefFor(page.slug), label: page.label });
  }
  return items;
}
