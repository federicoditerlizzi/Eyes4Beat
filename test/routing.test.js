import test from 'node:test';
import assert from 'node:assert/strict';
import { blankMap } from '../src/config.js';
import { computeTargetState, NEUTRAL_TARGETS } from '../src/routing.js';

const targetControls = Object.fromEntries(
  ['pulse', 'dist', 'luma', 'sat', 'glow', 'parts', 'zoom'].map((key) => [key, 1]),
);

function compute(overrides = {}) {
  return computeTargetState({
    map: blankMap(),
    sources: {},
    activeSources: {},
    intensity: targetControls,
    reactivity: targetControls,
    globalReactivity: 1,
    ...overrides,
  });
}

test('returns a fully neutral image with no routed sources', () => {
  assert.deepEqual(compute(), NEUTRAL_TARGETS);
});

test('positive energy routing drives zoom above neutral', () => {
  const map = blankMap();
  map.energy.zoom = 0.5;
  assert.ok(compute({ map, sources: { energy: 0.8 }, activeSources: { energy: true } }).zoom > 1);
});

test('disabled sources never affect a target', () => {
  const map = blankMap();
  map.energy.dist = 1;
  assert.equal(compute({ map, sources: { energy: 1 }, activeSources: { energy: false } }).dist, 0);
});

test('target intensity zero disables that target', () => {
  const map = blankMap();
  map.kick.pulse = 1;
  const intensity = { ...targetControls, pulse: 0 };
  assert.equal(compute({ map, sources: { kick: 1 }, activeSources: { kick: true }, intensity }).pulse, 0);
});
