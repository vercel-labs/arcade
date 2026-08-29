import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHESS_PIECE_NAMES,
  fetchChessPieceMeshes,
  measureChessPieceMeshes,
  parseChessPieceMeshes,
  type ChessPieceObjSources,
} from './pieces.ts';

const OBJ = [
  'v -0.5 0 0',
  'v 0.5 0 0',
  'v 0 1 0',
  'f 1 2 3',
].join('\n');

const SOURCES = Object.fromEntries(CHESS_PIECE_NAMES.map((name) => [name, OBJ])) as ChessPieceObjSources;

test('Chess visual module parses and normalizes a complete OBJ piece set', () => {
  const meshes = parseChessPieceMeshes(SOURCES);
  assert.equal(meshes.king.indices.length, 3);
  assert.deepEqual(measureChessPieceMeshes(meshes, 2), { scale: 2, square: 2.5 });
});

test('browser Chess model loader resolves every production piece through an injected transport', async () => {
  const urls: string[] = [];
  const meshes = await fetchChessPieceMeshes('/models/chess/', async (url) => {
    urls.push(url);
    return OBJ;
  });
  assert.equal(meshes.knight.indices.length, 3);
  assert.deepEqual(urls, CHESS_PIECE_NAMES.map((name) => `/models/chess/${name}.obj`));
});
