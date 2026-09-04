import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CopyPageButton } from '../docs-client';
import { APP_DOCS } from '../docs-app';
import { CORE_DOCS, type DocPage } from '../docs-content';
import { GAME_DOCS } from '../docs-games';
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
];
const findDoc = (slug: string) => DOCS.find((page) => page.slug === slug);
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
  const sectionIds = page.sections.map((section) => slugify(section.heading));
  const index = DOCS.findIndex((entry) => entry.slug === page.slug);
  const previous = index > 0 ? DOCS[index - 1] : null;
  const next = index < DOCS.length - 1 ? DOCS[index + 1] : null;

  return <article className="doc-article" data-doc-article>
      <header className="doc-page-header"><nav aria-label="Breadcrumb" className="doc-breadcrumbs"><Link href="/docs">Docs</Link>{page.navParent ? <><span>/</span><Link href={`/docs/${page.navParent}`}>{sectionLabel(page.navParent)}</Link></> : null}{page.slug ? <><span>/</span><span>{page.label}</span></> : null}</nav><h1>{page.title}</h1><p>{page.summary}</p><div className="doc-actions"><CopyPageButton /></div></header>
      {page.body ?? page.sections.map((section, sectionIndex) => { const id = sectionIds[sectionIndex]; return <section id={id} key={section.heading}><h2><a aria-label={`Link to ${section.heading}`} href={`#${id}`}>{section.heading}</a></h2><div>{section.body}</div></section>; })}
      <nav aria-label="Documentation pagination" className="doc-pagination">{previous ? <Link href={hrefFor(previous.slug)}><span>Previous</span><strong>← {previous.label}</strong></Link> : <span />}{next ? <Link href={hrefFor(next.slug)}><span>Next</span><strong>{next.label} →</strong></Link> : <span />}</nav>
    </article>;
}

function slugify(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
