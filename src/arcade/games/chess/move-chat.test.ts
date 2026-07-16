import assert from 'node:assert/strict';
import test from 'node:test';
import { chessMoveChat } from './hud.ts';

test('chessMoveChat: legal move → grey event line with the mover glyph + SAN', () => {
  const white = chessMoveChat('Nf3', 0, false); // ply 0 = White
  assert.deepEqual(white, { text: '♘ Nf3', model: '', event: true, error: false });

  const black = chessMoveChat('e5', 1, false); // ply 1 = Black; a pawn push
  assert.deepEqual(black, { text: '♟ e5', model: '', event: true, error: false });
});

test('chessMoveChat: illegal move → red event line tagged "(illegal)"', () => {
  const m = chessMoveChat('Qh5', 2, true); // White queen, illegal
  assert.equal(m.text, '♕ Qh5 (illegal)');
  assert.equal(m.event, true);
  assert.equal(m.error, true);
});

test('chessMoveChat: castling reads as the king; captures/checks keep their SAN', () => {
  assert.equal(chessMoveChat('O-O', 0, false).text, '♔ O-O'); // White kingside
  assert.equal(chessMoveChat('O-O-O', 1, false).text, '♚ O-O-O'); // Black queenside
  assert.equal(chessMoveChat('Bxc6+', 0, false).text, '♗ Bxc6+'); // capture with check
  assert.equal(chessMoveChat('exd5', 1, false).text, '♟ exd5'); // pawn capture
});
