import assert from 'node:assert/strict';
import test from 'node:test';
import { NoticeToast, noticeToastHeight } from './notice-toast.ts';

test('NoticeToast is blocking with focusable action and dismiss controls', () => {
  let opened = 0;
  let dismissed = 0;
  const toast = NoticeToast({ id: 'billing', severity: 'error', title: 'out of credit', body: 'buy AI Gateway credit to resume model requests.', action: { label: 'buy AI Gateway credit', onClick: () => opened++ }, onDismiss: () => dismissed++ });
  assert.ok(toast.onMouse, 'modal scrim owns pointer input');
  const buttons = JSON.stringify(toast).match(/"kind":"button"/g) ?? [];
  assert.equal(buttons.length, 2);
  const find = (node: typeof toast, id: string): typeof toast | undefined => node.id === id ? node : node.children?.map((child) => find(child, id)).find(Boolean);
  const action = find(toast, 'billing-action');
  action?.onClick?.();
  assert.equal(opened, 1);
  find(toast, 'billing-close')?.onClick?.();
  assert.equal(dismissed, 1);
});

test('noticeToastHeight matches the dialog child, gap, and padding geometry', () => {
  assert.equal(noticeToastHeight({ id: 'one', severity: 'warning', title: 'warning', body: 'one line' }), 5);
  assert.equal(noticeToastHeight({ id: 'action', severity: 'error', title: 'error', body: 'one line', actionLabel: 'retry' }), 7);
  assert.equal(noticeToastHeight({ id: 'wrapped', severity: 'warning', title: 'warning', body: 'one two three four five six seven eight nine ten', actionLabel: 'retry' }, 28), 9);
  assert.equal(noticeToastHeight({ id: 'boundary', severity: 'warning', title: 'warning', body: '1234567890123456789012345' }, 28), 7);
  assert.equal(noticeToastHeight({ id: 'compact', severity: 'warning', title: 'warning', body: '12345678901234567890123' }, 18, true), 7);
});

test('NoticeToast wraps long copy inside the card width', () => {
  const toast = NoticeToast({ id: 'model', severity: 'warning', title: 'Model unavailable', body: 'provider/a-very-long-model-identifier cannot serve requests from this region.', width: 32, onDismiss: () => {} });
  const card = toast.children?.[0];
  assert.ok((card?.children?.length ?? 0) > 3);
  const title = card?.children?.find((node) => node.kind === 'text');
  assert.equal(title?.style.color, 'textStrong');
});
