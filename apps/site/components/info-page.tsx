import type { ReactNode } from 'react';

export function InfoPage({ eyebrow, title, children }: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return <main className="info-page mt-(--fd-nav-height)">
    <p className="info-page__eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    {children}
  </main>;
}
