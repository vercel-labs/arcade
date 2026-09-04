import assert from 'node:assert/strict';
import test from 'node:test';
import type { Node } from '../../tui/index.ts';
import { selectModelSeat } from './model-seat-picker.ts';
import { buildIslandersSetupPanel, islandersSeatColors, islandersSeatPicker, islandersSetupCommunicationMode, islandersSetupReady, islandersSetupSelection, communicationDropdown, modeDropdown, seatsDropdown, setIslandersSetupCommunicationMode } from './islanders-setup-panel.ts';

function collectNodes(root: Node): Node[] {
  return [root, ...(root.children ?? []).flatMap(collectNodes)];
}

test('Islanders setup defaults to a four-player table with creators pre-filled and models left to pick', () => {
  assert.equal(seatsDropdown.index, 2);
  assert.equal(islandersSeatColors().length, 4);
  assert.deepEqual([1, 2, 3].map((i) => islandersSeatPicker(i).creator), ['openai', 'anthropic', 'google'], 'you at seat 1 still face the ranking from the top');
  assert.equal(islandersSetupReady(), false, 'Start waits for real picks');
  assert.equal(islandersSetupSelection(), null);
  for (const i of [1, 2, 3]) {
    const picker = islandersSeatPicker(i);
    selectModelSeat(picker, picker.creator!, picker.models[0]!.id);
  }
  assert.equal(islandersSetupSelection()?.length, 4);
});

test('Islanders setup renders a persistent failed health row', () => {
  const panel = buildIslandersSetupPanel({ lines: ['gpt failed health check.'], failed: true });
  const status = collectNodes(panel).find((node) => node.text?.includes('failed health check'));
  assert.equal(status?.style.color, 'danger');
});

test('Islanders setup defaults to ambient communication on one stable-width explained row', () => {
  communicationDropdown.pick(0);
  assert.equal(islandersSetupCommunicationMode(), 'ambient');
  const panel = buildIslandersSetupPanel();
  const nodes: Node[] = [];
  const visit = (node: Node): void => {
    nodes.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(panel);
  const slot = nodes.find((node) => node.component === 'islanders-setup-communication');
  assert.equal(slot?.style.width, 14);
  assert.ok(nodes.some((node) => node.text === 'chat after key moments'));

  communicationDropdown.pick(1);
  assert.equal(islandersSetupCommunicationMode(), 'autoreply');
  const alternate = buildIslandersSetupPanel();
  const texts: string[] = [];
  const collect = (node: Node): void => {
    if (node.text) texts.push(node.text);
    for (const child of node.children ?? []) collect(child);
  };
  collect(alternate);
  assert.ok(texts.includes('chat after every action'));
  communicationDropdown.pick(0);
});

test('the in-game menu can update the next-match communication default', () => {
  setIslandersSetupCommunicationMode('autoreply');
  assert.equal(islandersSetupCommunicationMode(), 'autoreply');
  setIslandersSetupCommunicationMode('ambient');
  assert.equal(islandersSetupCommunicationMode(), 'ambient');
});

test('color selection is visible only when the human is playing', () => {
  modeDropdown.pick(0);
  let nodes = collectNodes(buildIslandersSetupPanel());
  assert.ok(nodes.some((node) => node.text === 'your color'));
  assert.ok(nodes.some((node) => node.component === 'islanders-setup-color'));

  modeDropdown.pick(1);
  nodes = collectNodes(buildIslandersSetupPanel());
  assert.equal(nodes.some((node) => node.text === 'your color'), false);
  const slot = nodes.find((node) => node.component === 'islanders-setup-color');
  assert.ok(slot, 'hidden color control stays mounted for switching back to play mode');
  const hidden = nodes.find((node) => node.children?.includes(slot) && node.style.width === 0 && node.style.height === 0);
  assert.ok(hidden, 'spectate keeps the color control only inside a zero-size mount');
  modeDropdown.pick(0);
});
