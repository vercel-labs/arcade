'use client';

import { IconCheck } from '@vercel/geistdocs/assets/icons/icon-check';
import { IconCopy } from '@vercel/geistdocs/assets/icons/icon-copy';
import { useEffect, useRef, useState } from 'react';

const INSTALL_COMMAND = 'npm i -g @vercel/arcade';

export function InstallCommand() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // The command remains visible and selectable when clipboard access is denied.
    }
  };

  return (
    <button
      aria-label={copied ? 'Copied' : `Copy: ${INSTALL_COMMAND}`}
      className="living-title__install-command"
      onClick={copy}
      type="button"
    >
      <code>{INSTALL_COMMAND}</code>
      <span aria-hidden="true" className="living-title__install-icon">
        <span className={copied ? 'is-hidden' : ''}><IconCopy size={14} /></span>
        <span className={copied ? '' : 'is-hidden'}><IconCheck size={14} /></span>
      </span>
    </button>
  );
}
