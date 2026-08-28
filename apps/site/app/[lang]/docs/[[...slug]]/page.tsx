import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DOCS, findDoc } from '../docs-content';

export function generateStaticParams() { return DOCS.map((page) => ({ slug: page.slug ? page.slug.split('/') : [] })); }

export async function generateMetadata({ params }: PageProps<'/[lang]/docs/[[...slug]]'>): Promise<Metadata> {
  const { slug = [] } = await params;
  const page = findDoc(slug.join('/'));
  return page ? { title: page.title, description: page.summary } : {};
}

export default async function DocsPage({ params }: PageProps<'/[lang]/docs/[[...slug]]'>) {
  const { slug = [] } = await params;
  const page = findDoc(slug.join('/'));
  if (!page) notFound();
  return <main className="doc-layout mt-(--fd-nav-height)">
    <aside className="doc-nav"><p>Arcade docs</p>{DOCS.map((entry) => <Link className={entry.slug === page.slug ? 'active' : ''} href={`/docs${entry.slug ? `/${entry.slug}` : ''}`} key={entry.slug || 'index'}>{entry.slug || 'overview'}</Link>)}</aside>
    <article className="doc-article"><header><span>{page.eyebrow}</span><h1>{page.title}</h1><p>{page.summary}</p></header>{page.sections.map((section) => <section key={section.heading}><h2>{section.heading}</h2><div>{section.body}</div></section>)}</article>
  </main>;
}
