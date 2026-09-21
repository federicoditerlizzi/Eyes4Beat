import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_CONFIG_SCHEMA_VERSION, applyTransitionEasing, classifyImageTrigger,
  beatsToSeconds, effectiveBeatDwell, effectiveTransitionDuration, nextSequenceIndex,
  normalizeImageConfigStore, pickTransitionFromPool, quantizeToBeatGrid,
  resolvePendingImageRequest, resolveSequencerTempo, transitionRunsAsCut,
} from '../src/image-sequencer.js';

const trigger = (pool, overrides = {}) => ({ pool, pickOrder: 'cycle', duration: 2.2, durationBeats: .5, easing: 'linear', wipeDirection: 'left', ...overrides });
const defaults = [{
  mode: 'auto', source: 'energy', timeBase: 'seconds', orderMode: 'sequential', threshold: .55,
  triggers: { timed: trigger(['crossfade']), event: trigger(['cut'], { duration: .05 }), manual: trigger(['crossfade']) },
  images: [{ enabled: true, duration: 10, durationBeats: 4, order: 0 }, { enabled: true, duration: 12, durationBeats: 4, order: 1 }],
}];

test('transition easing clamps progress and applies the supported curves', () => {
  assert.equal(applyTransitionEasing(-1, 'linear'), 0);
  assert.equal(applyTransitionEasing(.5, 'linear'), .5);
  assert.equal(applyTransitionEasing(.5, 'ease-in-out'), .5);
  assert.equal(applyTransitionEasing(.5, 'ease-out'), .875);
  assert.equal(applyTransitionEasing(2, 'ease-out'), 1);
});

test('effective duration respects bounds and eighty percent of dwell', () => {
  assert.equal(effectiveTransitionDuration(8, 2), 1.6);
  assert.equal(effectiveTransitionDuration(.01, 10), .05);
  assert.equal(effectiveTransitionDuration(20, 20), 8);
});

test('explicit cut and sub-threshold durations run as cuts', () => {
  assert.equal(transitionRunsAsCut('cut', 2), true);
  assert.equal(transitionRunsAsCut('crossfade', .059), true);
  assert.equal(transitionRunsAsCut('crossfade', .06), false);
});

test('cycle pools preserve order and wrap', () => {
  const config = trigger(['crossfade', 'wipe', 'iris']);
  let state = {};
  const picks = Array.from({ length: 4 }, () => {
    const result = pickTransitionFromPool(config, state);
    state = result.state;
    return result.id;
  });
  assert.deepEqual(picks, ['crossfade', 'wipe', 'iris', 'crossfade']);
});

test('random-no-repeat pools never repeat consecutively and single pools are stable', () => {
  const config = trigger(['cut', 'wipe', 'iris'], { pickOrder: 'random-no-repeat' });
  let state = {}, position = 0;
  const samples = [.01, .01, .9, .5, .01];
  const picks = samples.map(() => {
    const result = pickTransitionFromPool(config, state, () => samples[position++]);
    state = result.state;
    return result.id;
  });
  picks.slice(1).forEach((id, index) => assert.notEqual(id, picks[index]));
  assert.equal(pickTransitionFromPool(trigger(['glitch-cut']), {}, () => .9).id, 'glitch-cut');
});

test('trigger classification separates timed, musical events and manual requests', () => {
  assert.equal(classifyImageTrigger({ mode: 'auto', source: 'kick' }), 'timed');
  assert.equal(classifyImageTrigger({ mode: 'mapped', source: 'energy' }), 'timed');
  assert.equal(classifyImageTrigger({ mode: 'mapped', source: 'kick' }), 'event');
  assert.equal(classifyImageTrigger({ manual: true, mode: 'mapped', source: 'kick' }), 'manual');
});

test('pending request resolution keeps only the latest request without mutating inputs', () => {
  const current = { idx: 1, triggerClass: 'timed' };
  const next = { idx: 4, triggerClass: 'manual' };
  const result = resolvePendingImageRequest(current, next);
  assert.deepEqual(result, next);
  assert.notEqual(result, next);
  assert.deepEqual(current, { idx: 1, triggerClass: 'timed' });
  assert.deepEqual(next, { idx: 4, triggerClass: 'manual' });
});

test('phase-one transition config migrates into timed while new defaults fill other pools', () => {
  const stored = { schemaVersion: 1, configs: [{ mode: 'mapped', source: 'kick', transition: 'wipe', duration: 3.4, easing: 'ease-out', wipeDirection: 'down', threshold: .7, images: [{ duration: 5, order: 1 }, { enabled: false, duration: 8, order: 0 }] }] };
  const result = normalizeImageConfigStore(stored, defaults);
  assert.equal(result.schemaVersion, IMAGE_CONFIG_SCHEMA_VERSION);
  assert.deepEqual(result.configs[0].triggers.timed, trigger(['wipe'], { duration: 3.4, easing: 'ease-out', wipeDirection: 'down' }));
  assert.deepEqual(result.configs[0].triggers.event.pool, ['cut']);
  assert.deepEqual(result.configs[0].triggers.manual.pool, ['crossfade']);
  assert.deepEqual(result.configs[0].images.map(({ order }) => order), [1, 0]);
});

test('pre-phase-one crossfade configs still migrate without changing timed behavior', () => {
  const stored = [{ crossfade: 2.8, images: defaults[0].images }];
  const result = normalizeImageConfigStore(stored, defaults);
  assert.deepEqual(result.configs[0].triggers.timed.pool, ['crossfade']);
  assert.equal(result.configs[0].triggers.timed.duration, 2.8);
  assert.equal(result.configs[0].triggers.timed.easing, 'linear');
});

test('schema-two normalization removes invalid pool items and fills missing fields', () => {
  const stored = { schemaVersion: 2, configs: [{ triggers: { timed: { pool: ['wipe', 'unknown', 'wipe'], pickOrder: 'random-no-repeat', duration: 99 } } }] };
  const result = normalizeImageConfigStore(stored, defaults).configs[0];
  assert.deepEqual(result.triggers.timed.pool, ['wipe']);
  assert.equal(result.triggers.timed.pickOrder, 'random-no-repeat');
  assert.equal(result.triggers.timed.duration, 8);
  assert.deepEqual(result.triggers.event, defaults[0].triggers.event);
});

test('sequence order modes choose the expected next index', () => {
  const enabled = [0, 1, 2];
  assert.equal(nextSequenceIndex({ enabled, current: 1, mode: 'sequential' }).index, 2);
  assert.equal(nextSequenceIndex({ enabled, current: 2, mode: 'sequential' }).index, 0);
  let state = {};
  const ping = [];
  let current = 0;
  for (let i = 0; i < 5; i++) { const result = nextSequenceIndex({ enabled, current, mode: 'ping-pong', state }); current = result.index; state = result.state; ping.push(current); }
  assert.deepEqual(ping, [1, 2, 1, 0, 1]);
  assert.equal(nextSequenceIndex({ enabled, current: 1, mode: 'random-no-repeat', random: () => 0 }).index, 0);
});

test('random and shuffle previous navigation follows shown history', () => {
  let result = nextSequenceIndex({ enabled: [0, 1, 2], current: 0, mode: 'random-no-repeat', state: {}, random: () => .9 });
  result = nextSequenceIndex({ enabled: [0, 1, 2], current: result.index, mode: 'random-no-repeat', state: result.state, random: () => 0 });
  const previous = nextSequenceIndex({ enabled: [0, 1, 2], current: result.index, direction: -1, mode: 'random-no-repeat', state: result.state });
  assert.equal(previous.index, result.state.history[result.state.history.length - 2]);
});

test('shuffle produces permutations and avoids repeats across cycle boundaries', () => {
  const enabled = [0, 1, 2, 3];
  let current = 0, state = {}, position = 0;
  const samples = [.8, .2, .6, .1, .7, .3, .9, .4, .5, .05, .95, .25];
  const picks = [];
  for (let i = 0; i < 7; i++) {
    const result = nextSequenceIndex({ enabled, current, mode: 'shuffle', state, random: () => samples[position++ % samples.length] });
    current = result.index;state = result.state;picks.push(current);
  }
  picks.slice(1).forEach((id, index) => assert.notEqual(id, picks[index]));
  assert.equal(new Set([0, ...picks.slice(0, 3)]).size, 4);
  assert.equal(new Set(picks.slice(3, 7)).size, 4);
});

test('beat conversion and dwell round-up enforce the two-second auto minimum', () => {
  assert.equal(beatsToSeconds(4, 120), 2);
  assert.equal(effectiveBeatDwell(1, 120), 4);
  assert.equal(effectiveBeatDwell(2, 60), 2);
  assert.equal(effectiveBeatDwell(4, 150), 8);
});

test('beat-grid quantization returns the next boundary at or after the deadline', () => {
  assert.equal(quantizeToBeatGrid(11.1, 10, .5), 11.5);
  assert.equal(quantizeToBeatGrid(11.5, 10, .5), 11.5);
  assert.equal(quantizeToBeatGrid(9, 10, .5), 10);
});

test('tempo resolution prefers reliable, then last reliable, then 120 BPM', () => {
  assert.deepEqual(resolveSequencerTempo({ bpm: 128, confidence: .8, lastReliableBpm: 110 }), { bpm: 128, source: 'live', lastReliableBpm: 128 });
  assert.deepEqual(resolveSequencerTempo({ bpm: 130, confidence: .1, lastReliableBpm: 110 }), { bpm: 110, source: 'last', lastReliableBpm: 110 });
  assert.deepEqual(resolveSequencerTempo(), { bpm: 120, source: 'fallback', lastReliableBpm: 0 });
});

test('phase-two configs migrate to seconds and sequential without changing values', () => {
  const phaseTwo = { schemaVersion: 2, configs: [{ mode: 'auto', source: 'open', threshold: .6, triggers: { timed: trigger(['wipe'], { duration: 1.4 }), event: trigger(['cut'], { duration: .05 }), manual: trigger(['iris']) }, images: [{ enabled: true, duration: 7, order: 0 }, { enabled: true, duration: 9, order: 1 }] }] };
  const result = normalizeImageConfigStore(phaseTwo, defaults).configs[0];
  assert.equal(result.timeBase, 'seconds');
  assert.equal(result.orderMode, 'sequential');
  assert.equal(result.triggers.timed.duration, 1.4);
  assert.deepEqual(result.images.map(image => image.duration), [7, 9]);
});
