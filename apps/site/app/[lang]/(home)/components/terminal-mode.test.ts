import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARCADE_MODE_MARKER, HOSTED_SHELL_GUIDE, SHELL_MODE_MARKER, TerminalModeDetector, TerminalModeOutputFilter, hostedBrowserUrl, terminalFontGeometry, terminalFontSize } from './terminal-mode.ts';

test('hosted terminal mode follows alternate-screen entry and exit', () => {
  const detector = new TerminalModeDetector();
  assert.equal(detector.mode(), 'shell');
  assert.equal(detector.push('prompt\r\n\x1b[?1049h'), 'arcade');
  assert.equal(detector.push('\x1b[?1006hgame frame'), 'arcade');
  assert.equal(detector.push('\x1b[?1049lprompt'), 'shell');
});

test('mode detector handles escape sequences split across socket packets', () => {
  const detector = new TerminalModeDetector();
  detector.push('\x1b[?10');
  assert.equal(detector.push('49h'), 'arcade');
  detector.push('\x1b[?104');
  assert.equal(detector.push('9l'), 'shell');
});

test('mouse tracking is an equivalent hosted Arcade mode signal', () => {
  const detector = new TerminalModeDetector();
  assert.equal(detector.push('\x1b[?1003h\x1b[?1006h'), 'arcade');
  assert.equal(detector.push('\x1b[?1006l\x1b[?1003l'), 'shell');
});

test('private hosted OSC mode event is authoritative', () => {
  const detector = new TerminalModeDetector();
  assert.equal(detector.push('\x1b]777;arcade=1\x07'), 'arcade');
  assert.equal(detector.push('\x1b]777;arcade=0\x1b\\'), 'shell');
});

test('hosted wrapper markers are stripped even when split across packets', () => {
  const filter = new TerminalModeOutputFilter();
  assert.deepEqual(filter.push(`prompt${ARCADE_MODE_MARKER.slice(0, 7)}`), { mode: 'shell', output: 'prompt' });
  assert.deepEqual(filter.push(`${ARCADE_MODE_MARKER.slice(7)}game`), { mode: 'arcade', output: 'game' });
  assert.deepEqual(filter.push(`done${SHELL_MODE_MARKER}prompt`), { mode: 'shell', output: 'doneprompt' });
});

test('mobile terminal fonts gain cells without shrinking desktop text', () => {
  assert.equal(terminalFontSize(375), 9);
  assert.equal(terminalFontSize(430), 10);
  assert.equal(terminalFontSize(844, true), 10);
  assert.equal(terminalFontSize(900), 12);
});

test('hosted xterm geometry approaches the renderer two-to-one cell convention', () => {
  assert.deepEqual(terminalFontGeometry(12), { letterSpacing: 1, lineHeight: 1 });
  assert.deepEqual(terminalFontGeometry(9), { letterSpacing: 0.5, lineHeight: 1 });
  assert.match(HOSTED_SHELL_GUIDE, /Preparing the isolated shell in the background/);
});

test('hosted browser bridge accepts only Vercel HTTPS URLs', () => {
  assert.equal(hostedBrowserUrl(`open=${encodeURIComponent('https://vercel.com/login?code=abc')}`), 'https://vercel.com/login?code=abc');
  assert.equal(hostedBrowserUrl(`open=${encodeURIComponent('https://evil.example/login')}`), null);
  assert.equal(hostedBrowserUrl(`open=${encodeURIComponent('javascript:alert(1)')}`), null);
});
