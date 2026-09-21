import test from 'node:test';
import assert from 'node:assert/strict';
import { NEUTRAL_TARGETS } from '../src/routing.js';
import { applyPanicTargets } from '../src/show-safety.js';

const routed = { pulse: .8, dist: .6, glow: 1.2, luma: .7, sat: 1.3, parts: .9, zoom: 1.25 };

test('panic returns exactly neutral targets', () => {
  assert.deepEqual(applyPanicTargets(routed, { panic: true, now: 1000 }), NEUTRAL_TARGETS);
});

test('panic release eases from neutral toward routed targets', () => {
  const start = applyPanicTargets(routed, { releaseStartedAt: 1000, now: 1000, duration: 300 });
  const middle = applyPanicTargets(routed, { releaseStartedAt: 1000, now: 1150, duration: 300 });
  const end = applyPanicTargets(routed, { releaseStartedAt: 1000, now: 1300, duration: 300 });
  assert.deepEqual(start, NEUTRAL_TARGETS);
  assert.equal(middle.pulse, routed.pulse * .5);
  assert.equal(middle.zoom, 1 + (routed.zoom - 1) * .5);
  assert.deepEqual(end, routed);
});

test('safety calculation never mutates routed or neutral input state', () => {
  const input = { ...routed };
  const neutralBefore = { ...NEUTRAL_TARGETS };
  applyPanicTargets(input, { panic: true });
  applyPanicTargets(input, { releaseStartedAt: 100, now: 200 });
  assert.deepEqual(input, routed);
  assert.deepEqual(NEUTRAL_TARGETS, neutralBefore);
});
