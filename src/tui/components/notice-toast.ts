import { Box, Text } from '../nodes.ts';
import type { Node } from '../types.ts';
import { wrapText } from '../text.ts';
import type { ColorToken } from '../theme.ts';
import { Dialog } from './dialog.ts';
import { RoundedButton } from '../button.ts';
import { Modal } from './modal.ts';

export interface NoticeToastOpts {
  id: string;
  severity: 'warning' | 'error';
  title: string;
  body: string;
  width?: number;
  onDismiss: () => void;
  action?: { label: string; onClick: () => void };
  actionColor?: ColorToken;
  actionBorderColor?: ColorToken;
}

export interface NoticeToastView {
  id: string;
  severity: 'warning' | 'error';
  title: string;
  body: string;
  actionLabel?: string;
}

export function noticeToastHeight(view: NoticeToastView, width = 44): number {
  const bodyWidth = Math.max(24, width - 4);
  const bodyLines = wrapText(view.body, bodyWidth).length;
  const children = 1 + bodyLines + (view.actionLabel ? 1 : 0);
  return children + Math.max(0, children - 1) + 2;
}

/** Centered blocking notice. The modal scrim dims the scene and owns pointer input. */
export function NoticeToast(opts: NoticeToastOpts): Node {
  const width = Math.max(28, opts.width ?? 44);
  const bodyWidth = width - 4;
  const titleColor: ColorToken = opts.severity === 'error' ? 'danger' : 'textStrong';
  const body = wrapText(opts.body, bodyWidth).map((text) => Text({ text, style: { color: 'textPrimary' } }));
  const controls = opts.action
    ? [RoundedButton({ id: `${opts.id}-action`, label: opts.action.label, onClick: opts.action.onClick, color: opts.actionColor ?? 'textStrong', borderColor: opts.actionBorderColor ?? 'textStrong', padding: [0, 3] })]
    : [];
  const card = Dialog({
    title: opts.title,
    titleColor,
    onClose: opts.onDismiss,
    closeId: `${opts.id}-close`,
    closeInset: 1,
    width,
    padding: [1, 3],
    background: 'surfaceChrome',
  }, [
    ...body,
    ...(controls.length ? [Box({ width: bodyWidth, justifyContent: 'start' }, controls)] : []),
  ]);
  return Modal(card, { onDismiss: opts.onDismiss });
}
