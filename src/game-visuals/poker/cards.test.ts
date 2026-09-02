import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pokerCardBackTexture, pokerCardFaceTexture } from './cards.ts';
import { parseCard } from '../../rules/poker/cards.ts';

test('browser-safe Poker faces preserve authentic red and black suit ink', () => {
  const ace = pokerCardFaceTexture(parseCard('As')!);
  const king = pokerCardFaceTexture(parseCard('Kh')!);
  assert.ok(hasDarkInk(ace));
  assert.ok(hasRedInk(king));
  assert.deepEqual([ace.width, ace.height], [250, 350]);
  assert.deepEqual([pokerCardBackTexture().width, pokerCardBackTexture().height], [200, 280]);
});

test('shared Poker back centers the production white triangle', () => {
  const back = pokerCardBackTexture();
  let sx = 0, sy = 0, count = 0;
  for (let y = 0; y < back.height; y++) for (let x = 0; x < back.width; x++) {
    const i = (y * back.width + x) * 4;
    if (back.data[i] < 220 || back.data[i + 1] < 220 || back.data[i + 2] < 220) continue;
    sx += x; sy += y; count++;
  }
  assert.ok(count > 100);
  assert.ok(Math.abs(sx / count - back.width / 2) < 1);
  assert.ok(Math.abs(sy / count - back.height * 0.47) < back.height * 0.04);
});

function hasDarkInk(texture: ReturnType<typeof pokerCardFaceTexture>): boolean {
  for (let i = 0; i < texture.data.length; i += 4) if (texture.data[i] < 40 && texture.data[i + 1] < 40 && texture.data[i + 2] < 40) return true;
  return false;
}

function hasRedInk(texture: ReturnType<typeof pokerCardFaceTexture>): boolean {
  for (let i = 0; i < texture.data.length; i += 4) if (texture.data[i] > 150 && texture.data[i + 1] < 60 && texture.data[i + 2] < 70) return true;
  return false;
}
