import assert from 'node:assert/strict';
import test from 'node:test';
import type { Node } from '../../tui/index.ts';
import { buildCatanSetupPanel, catanSeatColors, catanSetupCommunicationMode, catanSetupSelection, communicationDropdown, seatsDropdown } from './catan-setup-panel.ts';

test('Catan setup defaults to a four-player table', () => {
  assert.equal(seatsDropdown.index, 2);
  assert.equal(catanSeatColors().length, 4);
  assert.equal(catanSetupSelection()?.length, 4);
});

test('Catan setup defaults to ambient communication on one stable-width explained row', () => {
  communicationDropdown.pick(0);
  assert.equal(catanSetupCommunicationMode(), 'ambient');
  const panel = buildCatanSetupPanel();
  const nodes: Node[] = [];
  const visit = (node: Node): void => {
    nodes.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(panel);
  const slot = nodes.find((node) => node.component === 'catan-setup-communication');
  assert.equal(slot?.style.width, 14);
  assert.ok(nodes.some((node) => node.text === 'chat after key moments'));

  communicationDropdown.pick(1);
  assert.equal(catanSetupCommunicationMode(), 'autoreply');
  const alternate = buildCatanSetupPanel();
  const texts: string[] = [];
  const collect = (node: Node): void => {
    if (node.text) texts.push(node.text);
    for (const child of node.children ?? []) collect(child);
  };
  collect(alternate);
  assert.ok(texts.includes('chat after every action'));
  communicationDropdown.pick(0);
});
