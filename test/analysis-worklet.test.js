import test from 'node:test';
import assert from 'node:assert/strict';
import { FeatureBatch, PAYLOAD_SIZE, decodeFeatures } from '../src/analysis/messages.js';
import { MusicalLayers, FEATURE_KEYS } from '../src/analysis/layers.js';
import { AnalysisEngine } from '../src/analysis/engine.js';
import { LoadMonitor } from '../src/analysis/load-monitor.js';
import { AdaptiveNormalizer } from '../src/analysis/normalize.js';
import { AdaptiveTrigger } from '../src/analysis/onset.js';
import { TempoTracker } from '../src/analysis/tempo.js';

let Processor;
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.messages = [];this.port = { postMessage: (message, transfer) => this.messages.push(structuredClone(message, { transfer })) }; }
};
globalThis.registerProcessor = (name, value) => { Processor = value; };
await import('../src/analysis/worklet.js');
const recycle = (processor, message) => {
  const data = structuredClone({ type: 'recycle', kind: message.type, slot: message.slot, payload: message.payload }, { transfer: [message.payload.buffer] });
  processor.receive(data);
};
function drain(processor, callback = () => {}) { for (const message of processor.messages) { callback(message);recycle(processor, message); }processor.messages.length = 0; }

const feature = () => structuredClone(new AnalysisEngine({ sampleRate: 48000 }).features);
test('event batches preserve all intervening events exactly once in timestamp order', () => {
  const batch = new FeatureBatch(), layers = new MusicalLayers(48000 / 512), f = feature(), expected = [];
  const origin = 36000;
  for (let i = 0; i < 20; i++) {
    f.timestamp = origin + i * 512 / 48000;f.events.kick = i % 2 === 0;f.events.snare = i % 3 === 0;f.events.beat = i % 4 === 0;
    for (const type of ['kick', 'snare', 'beat']) if (f.events[type]) expected.push({ type, timestamp: f.timestamp });
    batch.add(f);layers.push(f);
  }
  const payload = new Float32Array(PAYLOAD_SIZE), start = batch.write(payload, f, layers);
  const decoded = decodeFeatures({ payload, timestamp: f.timestamp, origin: start, count: batch.count });
  assert.equal(decoded.eventBatch.length, expected.length);
  decoded.eventBatch.forEach((event, i) => { assert.equal(event.type, expected[i].type);assert.ok(Math.abs(event.timestamp - expected[i].timestamp) < 1e-8); });
  batch.reset();assert.equal(batch.count, 0);
});

test('worklet transfers two recycled buffers at ~50 Hz; diagnostics opt in at <=10 Hz', () => {
  const processor = new Processor({}), samples = new Float32Array(128).fill(.1), inputs = [[samples]];
  let count = 0, diagnosticCount = 0;const slots = new Set();
  for (let i = 0; i < 375; i++) {
    processor.process(inputs);
    drain(processor, message => { assert.equal(message.type, 'features');count++;slots.add(message.slot);assert.ok(message.payload.byteLength); });
  }
  assert.ok(count >= 44 && count <= 50, `features ${count}`);assert.equal(slots.size, 2);
  processor.receive({ type: 'diagnostics', value: true });
  for (let i = 0; i < 375; i++) { processor.process(inputs);drain(processor, message => { if (message.type === 'diagnostics') diagnosticCount++; }); }
  assert.ok(diagnosticCount >= 9 && diagnosticCount <= 10);
  processor.receive({ type: 'diagnostics', value: false });
  for (let i = 0; i < 80; i++) { processor.process(inputs);drain(processor, message => assert.equal(message.type, 'features')); }
});

test('a stalled main thread keeps events until a transferred buffer returns', () => {
  const processor = new Processor({}), f = feature(), inputs = [[new Float32Array(128)]];
  for (let i = 0; i < 40; i++) processor.process(inputs);
  assert.equal(processor.messages.length, 2);assert.ok(processor.slots.every(slot => slot === null));
  for (let i = 0; i < 15; i++) { f.timestamp = .11 + i * .01;f.events.kick = true;f.events.snare = i % 2 === 0;processor.batch.add(f); }
  const expected = processor.batch.count;
  drain(processor);processor.process(inputs);
  assert.equal(processor.messages.length, 1);assert.equal(processor.messages[0].count, expected);
  assert.equal(processor.batch.count, 0);drain(processor);
  for (let i = 0; i < 20; i++) { processor.process(inputs);drain(processor, message => assert.equal(message.count, 0)); }
});

test('calibration sums every hop, independently of diagnostic visibility and message cadence', () => {
  const processor = new Processor({}), reference = new AnalysisEngine({ sampleRate: 48000 });
  const samples = new Float32Array(128);for (let i = 0; i < samples.length; i++) samples[i] = .05 * Math.sin(i * .4);
  const inputs = [[samples]], expected = new Float64Array(1025), actual = new Float64Array(1025);
  let expectedPower = 0, actualPower = 0, expectedCount = 0, actualCount = 0;
  processor.receive({ type: 'capture-calibration', value: true });
  for (let q = 0; q < 800; q++) {
    reference.push(samples, f => { expectedCount++;expectedPower += f.meter.rms ** 2;for (let i = 0; i < 1025; i++) expected[i] += f.spectrum[i]; });
    processor.process(inputs);drain(processor, message => {
      if (message.type !== 'calibration-sample') return;
      actualCount += message.count;actualPower += message.power;for (let i = 0; i < 1025; i++) actual[i] += message.payload[i];
    });
  }
  assert.equal(actualCount + processor.calibrationCount, expectedCount);
  assert.ok(Math.abs(actualPower + processor.calibrationPower - expectedPower) < 1e-12);
  for (let i = 0; i < 1025; i++) assert.ok(Math.abs(actual[i] + processor.calibrationSum[i] - expected[i]) < 1e-7);
});

test('Fast and Context retain the original hop-domain formulas and rolling windows', () => {
  const layers = new MusicalLayers(48000 / 512), f = feature(), history = [], fast = [0, 0, 0, 0, 0, 0, .6], context = [...fast];
  const fastK = [.30, .22, .26, .30, .18, .13, .10], contextK = [.18, .12, .15, .16, .10, .065, .05], seconds = [3, 6, 4, 4, 6, 12, 15];
  for (let n = 0; n < 4000; n++) {
    f.timestamp = n * 512 / 48000;
    const values = FEATURE_KEYS.map((key, k) => f.rawValues[k] = (Math.sin(n * .03 + k) + 1) / 2);history.push({ time: f.timestamp, values });
    while (history[0].time < f.timestamp - 20) history.shift();
    layers.push(f);
    for (let k = 0; k < 7; k++) {
      fast[k] += (values[k] - fast[k]) * fastK[k];let sum = 0, count = 0;
      for (let i = history.length - 1; i >= 0 && history[i].time >= f.timestamp - seconds[k]; i--) { sum += history[i].values[k];count++; }
      context[k] += (sum / count - context[k]) * contextK[k];
      assert.ok(Math.abs(layers.fast[k] - fast[k]) < 1e-12);assert.ok(Math.abs(layers.context[k] - context[k]) < 1e-12);
    }
  }
});

test('exact normalizer percentiles and detector median/MAD match sorting references', () => {
  const normalizer = new AdaptiveNormalizer(20), trigger = new AdaptiveTrigger({ historySize: 30 }), values = [], detector = [];let output = 0, lastAt = -Infinity;
  for (let i = 0; i < 2500; i++) {
    const value = Math.round((Math.sin(i * .19) + 1) * 12) / 12, time = i / 20;
    values.push(value);if (values.length > 1200) values.shift();const sorted = [...values].sort((a, b) => a - b);
    let low = sorted[Math.floor(.15 * (sorted.length - 1))], high = sorted[Math.floor(.9 * (sorted.length - 1))];
    if (high - low < .25) { const center = (low + high) / 2;low = center - .25 * .35;high = center + .25 * .65; }
    const target = Math.max(0, Math.min(1, (value - low) / Math.max(1e-4, high - low)));output += (target - output) * (target > output ? .35 : .045);
    assert.equal(normalizer.push(value), output);
    detector.push(value);if (detector.length > 30) detector.shift();const ordered = [...detector].sort((a, b) => a - b), median = ordered[Math.floor(ordered.length / 2)] || 0;
    const deviations = ordered.map(v => Math.abs(v - median)).sort((a, b) => a - b), deviation = deviations[Math.floor(deviations.length / 2)] || 1e-6, threshold = median + 2.5 * deviation;
    const expected = detector.length > 12 && value > Math.max(threshold, 1e-5) && time - lastAt >= .06;if (expected) lastAt = time;
    const result = trigger.push(value, time);assert.equal(result.threshold, threshold);assert.equal(result.trigger, expected);
  }
});

test('incremental correlations match direct mean-centered autocorrelation after ring wraps', () => {
  const tracker = new TempoTracker(93.75), values = [];
  for (let n = 0; n < 4000; n++) {
    const value = n % 47 < 3 ? .8 : .02 * (1 + Math.sin(n));tracker.push(value, n / 93.75);values.push(value);if (values.length > tracker.max) values.shift();
    if (n < 400 || n % 47) continue;
    const mean = values.reduce((a, b) => a + b) / values.length;
    for (let lag = tracker.minLag; lag <= tracker.maxLag; lag++) {
      let cross = 0, left = 0, right = 0;
      for (let i = lag; i < values.length; i++) { const a = values[i] - mean, b = values[i - lag] - mean;cross += a * b;left += a * a;right += b * b; }
      assert.ok(Math.abs(tracker.correlation(lag) - cross / (Math.sqrt(left * right) + 1e-9)) < 1e-10);
    }
  }
});

test('sustained overload degrades twice, short spikes do not', () => {
  const monitor = new LoadMonitor(48000);
  for (let i = 0; i < 375; i++) monitor.observe(i === 20 ? 10 : .02, 128);
  assert.equal(monitor.mode, 0);
  for (let i = 0; i < 4000; i++) monitor.observe(1.5, 128);
  assert.equal(monitor.mode, 2);assert.ok(monitor.averageMs > 1.4);
});

test('mode migrations retain timeline, calibration, tempo and normalizer state', () => {
  const processor = new Processor({}), samples = new Float32Array(128).fill(.1), inputs = [[samples]];
  processor.receive({ type: 'calibration', value: { rms: .001, bins: Array(1025).fill(1e-9) } });
  for (let i = 0; i < 2000; i++) { processor.process(inputs);drain(processor); }
  let previous = processor.latest.timestamp;
  for (let mode = 1; mode <= 2; mode++) {
    processor.migrationPart = 0;processor.monitor.mode = mode;
    for (let i = 0; i < 40; i++) {
      processor.process(inputs);drain(processor, message => {
        if (message.type === 'features') { assert.ok(message.timestamp >= previous);previous = message.timestamp; }
      });
    }
    assert.equal(processor.mode, mode);assert.ok(processor.engine.normalizers.energy.history.count > 100);
    assert.equal(processor.engine.calibration.bins.length, processor.engine.fftSize / 2 + 1);
    assert.ok(Number.isFinite(processor.latest.raw.energy));
  }
});

test('ending calibration flushes the final partial batch, including buffer backpressure', () => {
  const processor = new Processor({}), inputs = [[new Float32Array(128).fill(.05)]];
  processor.receive({ type: 'capture-calibration', value: true });
  for (let i = 0; i < 150; i++) processor.process(inputs);
  const sent = processor.messages.filter(message => message.type === 'calibration-sample');
  assert.equal(sent.length, 2);assert.ok(processor.calibrationCount > 0);
  const pending = processor.calibrationCount;
  processor.receive({ type: 'capture-calibration', value: false });
  assert.equal(processor.calibrationFinishing, true);
  recycle(processor, sent[0]);
  const final = processor.messages.at(-1);assert.equal(final.type, 'calibration-sample');assert.equal(final.final, true);assert.equal(final.count, pending);
  assert.equal(processor.calibrationCount, 0);assert.equal(processor.calibrationFinishing, false);
});

test('seeking rebases layer history without changing its values or overflowing rings', () => {
  const layers = new MusicalLayers(48000 / 512), f = feature();f.rawValues.fill(.5);
  for (let n = 0; n < 2000; n++) { f.timestamp = n * 512 / 48000;layers.push(f); }
  const before = [...layers.context];layers.rebase();assert.deepEqual([...layers.context], before);
  for (let n = 0; n < 4000; n++) { f.timestamp = n * 512 / 48000;layers.push(f); }
  for (let i = 0; i < 7; i++) { assert.ok(layers.counts[i] < layers.capacity);assert.ok(Math.abs(layers.context[i] - .5) < 1e-12); }
});

test('overflow is explicitly reported instead of silently losing events', () => {
  const batch = new FeatureBatch(), f = feature();f.events.kick = true;
  for (let i = 0; i <= batch.times.length; i++) { f.timestamp = i;batch.add(f); }
  assert.equal(batch.overflow, true);assert.equal(batch.count, batch.times.length);
});

test('processor automatically changes modes and reports load under a sustained injected clock cost', async () => {
  const original = globalThis.performance;let ticks = 0;
  try {
    globalThis.performance = { now: () => ticks += 1.5 };
    await import('../src/analysis/worklet.js?overload-test');
  } finally { globalThis.performance = original; }
  const processor = new Processor({}), inputs = [[new Float32Array(128).fill(.1)]], modes = new Set();
  for (let i = 0; i < 4000; i++) {
    processor.process(inputs);
    drain(processor, message => { if (message.type === 'features') modes.add(message.mode); });
  }
  assert.deepEqual([...modes], [0, 1, 2]);assert.equal(processor.engine.fftSize, 1024);assert.equal(processor.engine.hopSize, 1024);
  assert.equal(processor.monitor.overloaded, true);assert.ok(processor.monitor.averageMs > 1.4);
});
