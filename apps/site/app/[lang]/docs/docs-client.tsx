'use client';

import { IconCheck } from '@vercel/geistdocs/assets/icons/icon-check';
import { IconChevronRight } from '@vercel/geistdocs/assets/icons/icon-chevron-right';
import { IconCopy } from '@vercel/geistdocs/assets/icons/icon-copy';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return <button aria-label={copied ? 'Copied code' : 'Copy code'} onClick={copy} type="button">{copied ? <IconCheck size={14} /> : <IconCopy size={14} />}</button>;
}

export function CopyPageButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const article = document.querySelector<HTMLElement>('[data-doc-article]');
    if (!article) return;
    await navigator.clipboard.writeText(articleMarkdown(article));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return <button className="doc-action" onClick={copy} type="button">{copied ? <IconCheck size={14} /> : <IconCopy size={14} />}<span>{copied ? 'Copied' : 'Copy page'}</span></button>;
}

export interface DocsNavItem { href: string; label: string; group?: string; drillIn?: boolean }

export function MobileDocsNav({ active, items }: { active: string; items: DocsNavItem[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);
  return <div className="doc-mobile-nav">
    <button aria-controls="doc-mobile-nav-sheet" aria-expanded={open} onClick={() => setOpen((value) => !value)} type="button"><span>Browse docs</span><span aria-hidden="true">{open ? '−' : '+'}</span></button>
    <div className={open ? 'open' : ''} id="doc-mobile-nav-sheet">
      <nav>{items.map((item, index) => item.group ? <span className="doc-sidebar__group" key={`${item.group}-${index}`}>{item.group}</span> : <Link aria-current={item.href === active ? 'page' : undefined} href={item.href} key={item.href} onClick={() => setOpen(false)}><span>{item.label}</span>{item.drillIn ? <span aria-hidden="true"><IconChevronRight size={16} /></span> : null}</Link>)}</nav>
    </div>
  </div>;
}

function articleMarkdown(article: HTMLElement): string {
  const lines: string[] = [];
  for (const node of article.querySelectorAll<HTMLElement>('h1, h2, h3, p, li, pre')) {
    if (node.closest('.doc-actions') || (node.parentElement?.closest('pre') && node.tagName !== 'PRE')) continue;
    const text = node.innerText.trim();
    if (!text) continue;
    if (node.tagName === 'H1') lines.push(`# ${text}`);
    else if (node.tagName === 'H2') lines.push(`## ${text}`);
    else if (node.tagName === 'H3') lines.push(`### ${text}`);
    else if (node.tagName === 'LI') lines.push(`- ${text}`);
    else if (node.tagName === 'PRE') lines.push(`\`\`\`\n${text}\n\`\`\``);
    else lines.push(text);
  }
  return `${lines.join('\n\n')}\n`;
}
