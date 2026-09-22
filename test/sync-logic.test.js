import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheUserKey, mergeRestoredChanges, overlapCursor, shouldApplyRemote } from '../src/library/sync-logic.js';

test('pull overlap subtracts ten seconds and versions reject duplicates/stale data', () => {
  assert.equal(overlapCursor('2026-01-01T00:00:20.000Z'), '2026-01-01T00:00:10.000Z');
  assert.equal(shouldApplyRemote({ version: 3 }, { version: 3 }), false);
  assert.equal(shouldApplyRemote({ version: 3 }, { version: 2 }), false);
  assert.equal(shouldApplyRemote({ version: 3 }, { version: 4 }), true);
});
test('user cache keys are stable, normalized and isolated', () => {
  assert.equal(cacheUserKey('User@Example.com'), cacheUserKey(' user@example.com '));
  assert.notEqual(cacheUserKey('a@example.com'), cacheUserKey('b@example.com'));
});
test('restore applies local fields over server identity and version', () => {
  const server = { id: 'a', projectId: 'p', name: 'Server', version: 4, look: { gain: 1 } };
  assert.deepEqual(mergeRestoredChanges(server, { name: 'Mine', look: { gain: 2 } }), { ...server, name: 'Mine', look: { gain: 2 } });
});
