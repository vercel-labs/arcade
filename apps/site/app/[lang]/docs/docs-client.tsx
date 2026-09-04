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

export function articleMarkdown(article: HTMLElement): string {
  const lines: string[] = [];
  const selector = 'h1, h2, h3, p, li, pre, dt, dd, .doc-note, .doc-cards > a, .source-link';
  for (const node of article.querySelectorAll<HTMLElement>(selector)) {
    if (node.closest('.doc-actions') || node.parentElement?.closest(selector)) continue;
    const text = inlineMarkdown(node).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (node.tagName === 'H1') lines.push(`# ${text}`);
    else if (node.tagName === 'H2') lines.push(`## ${text}`);
    else if (node.tagName === 'H3') lines.push(`### ${text}`);
    else if (node.tagName === 'LI') lines.push(`- ${text}`);
    else if (node.tagName === 'PRE') {
      const language = node.closest<HTMLElement>('.doc-code-block')?.dataset.language ?? '';
      lines.push(`\`\`\`${language}\n${node.innerText.trim()}\n\`\`\``);
    } else if (node.tagName === 'DT') lines.push(`**${text}**`);
    else if (node.tagName === 'DD') lines.push(text);
    else if (node.classList.contains('doc-note')) lines.push(`> ${text}`);
    else if (node.matches('.doc-cards > a')) {
      const title = node.querySelector('strong')?.innerText.trim() ?? text;
      const description = node.querySelector('span')?.innerText.trim();
      const href = node.getAttribute('href') ?? '';
      lines.push(`- [${title}](${href})${description ? ` — ${description}` : ''}`);
    } else if (node.classList.contains('source-link')) {
      lines.push(`Source: [${node.innerText.replace(/\s*↗\s*$/, '').trim()}](${node.getAttribute('href') ?? ''})`);
    }
    else lines.push(text);
  }
  return `${lines.join('\n\n')}\n`;
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return '';
  const content = [...node.childNodes].map(inlineMarkdown).join('');
  if (node.tagName === 'CODE') return `\`${content.trim()}\``;
  if (node.tagName === 'STRONG') return `**${content.trim()}**`;
  if (node.tagName === 'A') return `[${content.trim()}](${node.getAttribute('href') ?? ''})`;
  if (node.tagName === 'BR') return '\n';
  return content;
}
