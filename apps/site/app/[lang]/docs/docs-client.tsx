'use client';

import { IconCheck } from '@vercel/geistdocs/assets/icons/icon-check';
import { IconCopy } from '@vercel/geistdocs/assets/icons/icon-copy';
import { useState } from 'react';

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
      lines.push(`- [${title}](${href})${description ? `: ${description}` : ''}`);
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
