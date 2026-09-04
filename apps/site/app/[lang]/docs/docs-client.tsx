'use client';

import { IconCheck } from '@vercel/geistdocs/assets/icons/icon-check';
import { IconChevronRight } from '@vercel/geistdocs/assets/icons/icon-chevron-right';
import { IconCopy } from '@vercel/geistdocs/assets/icons/icon-copy';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { navigationForPathname, type DocsNavItem } from './docs-navigation';

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

function opensOutsideCurrentPage(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function DocsNavLinks({ active, items, onDrillIn }: { active: string; items: DocsNavItem[]; onDrillIn?: (item: DocsNavItem, trigger: HTMLAnchorElement) => void }) {
  return <>{items.map((item, index) => item.group
    ? <span className="doc-sidebar__group" key={`${item.group}-${index}`}>{item.group}</span>
    : <Link aria-current={item.href === active ? 'page' : undefined} href={item.href} key={item.href} onClick={item.drillIn && onDrillIn ? (event) => {
      if (!opensOutsideCurrentPage(event)) onDrillIn(item, event.currentTarget);
    } : undefined}><span>{item.label}</span>{item.drillIn ? <span aria-hidden="true"><IconChevronRight size={16} /></span> : null}</Link>)}</>;
}

export function DesktopDocsNav({ active, items, rootItems, sectionTitle }: { active: string; items: DocsNavItem[]; rootItems: DocsNavItem[]; sectionTitle: string | null }) {
  const routeSection = sectionTitle ? { title: sectionTitle, items } : null;
  const [selectedSection, setSelectedSection] = useState<typeof routeSection>(null);
  const activeSection = selectedSection ?? routeSection;
  const [view, setView] = useState<'root' | 'section'>(routeSection ? 'section' : 'root');
  const [sectionRevealed, setSectionRevealed] = useState(view === 'section');
  const sectionShown = view === 'section' && sectionRevealed;
  const scrollRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLAnchorElement>(null);
  const sectionHeaderRef = useRef<HTMLButtonElement>(null);
  const shouldFocusRootRef = useRef(false);
  const shouldFocusSectionRef = useRef(false);
  const [fade, setFade] = useState({ top: false, bottom: false });

  useEffect(() => {
    setSelectedSection(null);
    setView(sectionTitle ? 'section' : 'root');
  }, [sectionTitle]);

  useEffect(() => {
    if (view !== 'section') {
      setSectionRevealed(false);
      return;
    }
    const frame = requestAnimationFrame(() => setSectionRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, [view]);

  useLayoutEffect(() => {
    if (sectionShown && shouldFocusSectionRef.current) {
      sectionHeaderRef.current?.focus({ preventScroll: true });
      shouldFocusSectionRef.current = false;
      return;
    }
    if (!sectionShown && shouldFocusRootRef.current) {
      returnFocusRef.current?.focus({ preventScroll: true });
      shouldFocusRootRef.current = false;
    }
  }, [sectionShown]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const updateFade = () => {
      const top = element.scrollTop > 1;
      const paddingBottom = Number.parseFloat(getComputedStyle(element).paddingBottom) || 0;
      const bottom = element.scrollTop + element.clientHeight < element.scrollHeight - paddingBottom - 1;
      setFade((current) => current.top === top && current.bottom === bottom ? current : { top, bottom });
    };
    const frame = requestAnimationFrame(() => {
      element.querySelector<HTMLElement>('.doc-sidebar__pane.is-active [aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
      updateFade();
    });
    const resizeObserver = new ResizeObserver(updateFade);
    resizeObserver.observe(element);
    if (element.firstElementChild) resizeObserver.observe(element.firstElementChild);
    element.addEventListener('scroll', updateFade, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      element.removeEventListener('scroll', updateFade);
    };
  }, [active, activeSection?.title, view]);

  const selectSection = (item: DocsNavItem, trigger: HTMLAnchorElement) => {
    const navigation = navigationForPathname(item.href);
    if (!navigation.sectionTitle) return;
    returnFocusRef.current = trigger;
    shouldFocusSectionRef.current = true;
    setSelectedSection({ title: navigation.sectionTitle, items: navigation.items });
    setView('section');
  };

  const showRoot = () => {
    shouldFocusRootRef.current = true;
    setSelectedSection(null);
    setView('root');
  };

  return <aside aria-label="Documentation navigation" className="doc-sidebar"><nav className="doc-sidebar__scroll" data-fade-bottom={fade.bottom} data-fade-top={fade.top} ref={scrollRef}><div className="doc-sidebar__viewport">
    <div aria-hidden={sectionShown} className={`doc-sidebar__pane ${sectionShown ? 'is-left' : 'is-active'}`} data-doc-sidebar-pane="root" inert={sectionShown}>
      <DocsNavLinks active={active} items={rootItems} onDrillIn={selectSection} />
    </div>
    {activeSection ? <div aria-hidden={!sectionShown} className={`doc-sidebar__pane ${sectionShown ? 'is-active' : 'is-right'}`} data-doc-sidebar-pane="section" inert={!sectionShown}>
      <button aria-label="Back to all documentation sections" className="doc-sidebar__section-header" onClick={showRoot} ref={sectionHeaderRef} type="button"><span aria-hidden="true"><IconChevronRight size={16} /></span><strong>{activeSection.title}</strong><span aria-hidden="true" /></button>
      <DocsNavLinks active={active} items={activeSection.items} />
    </div> : null}
  </div></nav></aside>;
}

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
      <nav aria-label="Documentation navigation">{items.map((item, index) => item.group ? <span className="doc-sidebar__group" key={`${item.group}-${index}`}>{item.group}</span> : <Link aria-current={item.href === active ? 'page' : undefined} href={item.href} key={item.href} onClick={() => setOpen(false)}><span>{item.label}</span>{item.drillIn ? <span aria-hidden="true"><IconChevronRight size={16} /></span> : null}</Link>)}</nav>
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
