import { geistShikiTheme } from '@vercel/geistdocs/shiki-theme';
import { createHighlighter, type Highlighter, type ThemeRegistrationAny } from 'shiki';
import { CopyCodeButton } from './docs-client';

const globalForDocs = globalThis as unknown as { arcadeDocsHighlighter?: Promise<Highlighter> };

function highlighter(): Promise<Highlighter> {
  const existing = globalForDocs.arcadeDocsHighlighter;
  if (existing) return existing;
  const created = createHighlighter({
    themes: [geistShikiTheme as ThemeRegistrationAny],
    langs: ['typescript', 'bash', 'text'],
  });
  globalForDocs.arcadeDocsHighlighter = created;
  return created;
}

export async function CodeBlock({ children, title = 'TypeScript', language }: { children: string; title?: string; language?: 'typescript' | 'bash' | 'text' }) {
  const lang = language ?? (title === 'Terminal' ? 'bash' : title === 'Architecture' ? 'text' : 'typescript');
  const html = (await highlighter()).codeToHtml(children.trim(), { lang, theme: geistShikiTheme.name })
    .replace(/<span class="line"><\/span>/g, '<span class="line">&nbsp;</span>');
  return <div className="doc-code-block" data-language={lang}>
    <div className="doc-code-block__header"><span>{title}</span><CopyCodeButton code={children} /></div>
    <div className="doc-code-block__source" dangerouslySetInnerHTML={{ __html: html }} />
  </div>;
}
