import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePerformanceShortcut } from '../src/shortcuts.js';

const key = (code, extra = {}) => ({ code, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...extra });

test('number row selects direct archetypes', () => {
  assert.deepEqual(resolvePerformanceShortcut(key('Digit1'), 12), { type: 'select', index: 0 });
  assert.deepEqual(resolvePerformanceShortcut(key('Digit0'), 12), { type: 'select', index: 9 });
  assert.deepEqual(resolvePerformanceShortcut(key('Digit2', { shiftKey: true }), 12), { type: 'select', index: 11 });
});

test('out-of-range and modified number shortcuts are ignored', () => {
  assert.equal(resolvePerformanceShortcut(key('Digit6', { shiftKey: true }), 12), null);
  assert.equal(resolvePerformanceShortcut(key('Digit2', { ctrlKey: true }), 12), null);
});

test('navigation, transition and help shortcuts resolve', () => {
  assert.deepEqual(resolvePerformanceShortcut(key('ArrowLeft'), 6), { type: 'step', direction: -1 });
  assert.deepEqual(resolvePerformanceShortcut(key('KeyD'), 6), { type: 'step', direction: 1 });
  assert.deepEqual(resolvePerformanceShortcut(key('KeyS'), 6), { type: 'transition', mode: 'smooth' });
  assert.deepEqual(resolvePerformanceShortcut(key('KeyC'), 6), { type: 'transition', mode: 'cut' });
  assert.deepEqual(resolvePerformanceShortcut(key('Slash', { shiftKey: true }), 6), { type: 'help' });
  assert.deepEqual(resolvePerformanceShortcut(key('KeyB'), 6), { type: 'safety', control: 'blackout' });
  assert.deepEqual(resolvePerformanceShortcut(key('KeyP'), 6), { type: 'safety', control: 'panic' });
});

test('Alt or Option maps number and navigation keys to presets', () => {
  assert.deepEqual(resolvePerformanceShortcut(key('Digit1', { altKey: true }), 6), { type: 'preset-select', index: 0 });
  assert.deepEqual(resolvePerformanceShortcut(key('Digit0', { altKey: true }), 6), { type: 'preset-select', index: 9 });
  assert.deepEqual(resolvePerformanceShortcut(key('ArrowRight', { altKey: true }), 6), { type: 'preset-step', direction: 1 });
  assert.deepEqual(resolvePerformanceShortcut(key('KeyA', { altKey: true }), 6), { type: 'preset-step', direction: -1 });
  assert.equal(resolvePerformanceShortcut(key('Digit1', { altKey: true, shiftKey: true }), 6), null);
});
