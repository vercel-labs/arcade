import type { Metadata } from 'next';
import { IconChevronRight } from '@vercel/geistdocs/assets/icons/icon-chevron-right';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CopyPageButton, MobileDocsNav, type DocsNavItem } from '../docs-client';
import { APP_DOCS } from '../docs-app';
import { CORE_DOCS, type DocPage } from '../docs-content';
import { GAME_DOCS } from '../docs-games';
import { MOTIVATION_DOC } from '../docs-motivation';
import { GUIDE_DOCS, REFERENCE_DOCS } from '../docs-reference';

const hrefFor = (slug: string) => `/docs${slug ? `/${slug}` : ''}`;
const APP_INSERT_INDEX = CORE_DOCS.findIndex((page) => page.slug === 'getting-started') + 1;
const CORE_NAV_ITEMS: DocsNavItem[] = CORE_DOCS.map((page) => ({ href: hrefFor(page.slug), label: page.label }));
const DOCS = [...CORE_DOCS.slice(0, APP_INSERT_INDEX), ...APP_DOCS, ...CORE_DOCS.slice(APP_INSERT_INDEX), ...GAME_DOCS, ...GUIDE_DOCS, ...REFERENCE_DOCS, MOTIVATION_DOC];
const findDoc = (slug: string) => DOCS.find((page) => page.slug === slug);
const CORE_NAV: DocsNavItem[] = [...CORE_NAV_ITEMS.slice(0, APP_INSERT_INDEX), { href: '/docs/app', label: 'Using Arcade', drillIn: true }, ...CORE_NAV_ITEMS.slice(APP_INSERT_INDEX), { href: '/docs/games', label: 'Games', drillIn: true }, { href: '/docs/guides', label: 'Guides', drillIn: true }, { href: '/docs/reference', label: 'API Reference', drillIn: true }, { href: '/docs/motivation', label: 'Motivation' }];

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
  const nestedMode = page.slug === 'app' || page.navParent === 'app' ? 'app' : page.slug === 'reference' || page.navParent === 'reference' ? 'reference' : page.slug === 'guides' || page.navParent === 'guides' ? 'guides' : page.slug === 'games' || page.navParent === 'games' ? 'games' : null;
  const navItems = nestedMode === 'app' ? nestedNavItems(APP_DOCS, 'app') : nestedMode === 'reference' ? nestedNavItems(REFERENCE_DOCS, 'reference') : nestedMode === 'guides' ? nestedNavItems(GUIDE_DOCS, 'guides') : nestedMode === 'games' ? nestedNavItems(GAME_DOCS, 'games') : CORE_NAV;
  const sectionIds = page.sections.map((section) => slugify(section.heading));
  const index = DOCS.findIndex((entry) => entry.slug === page.slug);
  const previous = index > 0 ? DOCS[index - 1] : null;
  const next = index < DOCS.length - 1 ? DOCS[index + 1] : null;

  return <main className="doc-shell mt-(--fd-nav-height)">
    <MobileDocsNav active={activeHref} items={navItems} />
    <aside aria-label="Documentation navigation" className="doc-sidebar"><nav className="doc-sidebar__scroll">{nestedMode ? <Link aria-label="Back to all documentation sections" className="doc-sidebar__section-header" href="/docs"><span aria-hidden="true"><IconChevronRight size={16} /></span><strong>{nestedMode === 'app' ? 'Using Arcade' : nestedMode === 'reference' ? 'API Reference' : nestedMode === 'guides' ? 'Guides' : 'Games'}</strong><span aria-hidden="true" /></Link> : null}{navItems.map((item) => item.group ? <span className="doc-sidebar__group" key={`group-${item.group}`}>{item.group}</span> : <Link aria-current={item.href === activeHref ? 'page' : undefined} href={item.href} key={item.href}><span>{item.label}</span>{item.drillIn ? <span aria-hidden="true"><IconChevronRight size={16} /></span> : null}</Link>)}</nav></aside>
    <article className="doc-article" data-doc-article>
      <header className="doc-page-header"><nav aria-label="Breadcrumb" className="doc-breadcrumbs"><Link href="/docs">Docs</Link>{page.navParent ? <><span>/</span><Link href={`/docs/${page.navParent}`}>{page.navParent === 'app' ? 'Using Arcade' : page.navParent === 'reference' ? 'Reference' : page.navParent === 'guides' ? 'Guides' : 'Games'}</Link></> : null}{page.slug ? <><span>/</span><span>{page.label}</span></> : null}</nav><h1>{page.title}</h1><p>{page.summary}</p><div className="doc-actions"><CopyPageButton /></div></header>
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
