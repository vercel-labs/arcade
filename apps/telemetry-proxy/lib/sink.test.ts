import assert from 'node:assert/strict';
import test from 'node:test';
import { consoleSink } from './sink.ts';

test('consoleSink logs only counts, never record payloads', async () => {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  try {
    const result = await consoleSink.deliver('match', [{ payloadJson: 'SENTINEL_SECRET_MOVE_TEXT' }]);
    assert.equal(result, 'ok');
  } finally {
    console.log = original;
  }
  assert.equal(logs.length, 1);
  assert.match(logs[0], /"count":1/);
  assert.match(logs[0], /"kind":"match"/);
  assert.doesNotMatch(logs[0], /SENTINEL_SECRET_MOVE_TEXT/); // payloads never reach logs
});
