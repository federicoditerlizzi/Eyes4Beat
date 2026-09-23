import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisEngine } from '../src/analysis/engine.js';

function kickTrain(sampleRate, bpm, seconds, gain = .7, start = .5) {
  const signal = new Float32Array(Math.floor(sampleRate * seconds));
  for (let time = start; time < seconds; time += 60 / bpm) { const offset = Math.floor(time * sampleRate);for (let i = 0; i < sampleRate * .1 && offset + i < signal.length; i++) signal[offset + i] += gain * Math.sin(2 * Math.PI * 60 * i / sampleRate) * Math.exp(-i / (sampleRate * .025)); }
  return signal;
}
function run(signal, sampleRate) { const engine = new AnalysisEngine({ sampleRate }), frames = [];for (let index = 0; index < signal.length; index += 128) { const frame = engine.push(signal.subarray(index, index + 128));if (frame) frames.push(structuredClone(frame)); }return { engine, frames, last: frames.at(-1) }; }
function snareTrain(sampleRate, seconds) {
  const signal = new Float32Array(sampleRate * seconds);
  for (let time = 1; time < seconds; time += 1) { const offset = Math.floor(time * sampleRate);for (let i = 0; i < sampleRate * .1; i++) { const envelope = Math.min(1, i / (sampleRate * .008)) * Math.exp(-i / (sampleRate * .035));signal[offset + i] += .35 * (Math.sin(2 * Math.PI * 300 * i / sampleRate) + Math.sin(2 * Math.PI * 3200 * i / sampleRate) + Math.sin(2 * Math.PI * 5700 * i / sampleRate)) * envelope; } }
  return signal;
}

test('90 BPM kick train has single accurate kick events, tempo and stable phase', () => {
  const { engine, last } = run(kickTrain(48000, 90, 12), 48000);assert.ok(Math.abs(last.tempo.bpm - 90) < .5);
  for (let expected = 4.5; expected < 11.9; expected += 2 / 3) assert.ok(engine.kickTimes.some(time => Math.abs(time - expected) <= .015), `missing kick near ${expected}`);
  for (let index = 1; index < engine.kickTimes.length; index++) assert.ok(engine.kickTimes[index] - engine.kickTimes[index - 1] > .06);
  assert.ok(last.tempo.phase >= 0 && last.tempo.phase < 1);
});

test('snare spectrum triggers snare without kick and kick-only does not trigger snare', () => {
  const snares = run(snareTrain(48000, 6), 48000).engine;assert.ok(snares.snareTimes.length >= 4);assert.equal(snares.kickTimes.length, 0);
  const kicks = run(kickTrain(48000, 100, 8), 48000).engine;assert.ok(kicks.kickTimes.length >= 6);assert.equal(kicks.snareTimes.length, 0);
});

test('sample-rate changes preserve tempo and physical band level', () => {
  const results = [44100, 48000, 96000].map(rate => run(kickTrain(rate, 120, 12), rate));
  results.forEach(result => assert.ok(Math.abs(result.last.tempo.bpm - 120) < .5));
  const bass = results.map(result => Math.max(...result.frames.filter(frame => !frame.gate).map(frame => frame.bands.bass)));assert.ok(Math.max(...bass) - Math.min(...bass) < 2.5);
});

test('tempo estimator distinguishes 115, 120 and 125 BPM', () => {
  for (const bpm of [115, 120, 125]) assert.ok(Math.abs(run(kickTrain(48000, bpm, 12), 48000).last.tempo.bpm - bpm) < 1);
});

test('tempo tracker follows a 90 to 120 BPM change', () => {
  const sampleRate = 48000, signal = new Float32Array(sampleRate * 18);signal.set(kickTrain(sampleRate, 90, 9));
  const second = kickTrain(sampleRate, 120, 9, .7, 0);for (let index = 0; index < second.length; index++) signal[sampleRate * 9 + index] += second[index];
  const result = run(signal, sampleRate);assert.ok(Math.abs(result.last.tempo.bpm - 120) < 2);
});

test('adaptive normalization is level invariant and full scale is not pinned', () => {
  const averageActive = gain => { const result = run(kickTrain(48000, 120, 14, gain), 48000);const active = result.frames.slice(-400).filter(frame => !frame.gate);return active.reduce((sum, frame) => sum + frame.raw.energy, 0) / active.length; };
  const quiet = averageActive(.1), loud = averageActive(.5), full = averageActive(1);assert.ok(Math.abs(quiet - loud) < .18);assert.ok(full < .9);
});

test('silence and calibrated noise floor produce zero states and no events', () => {
  const silent = run(new Float32Array(48000 * 3), 48000);assert.deepEqual(silent.last.raw, { energy: 0, density: 0, drive: 0, boombap: 0, bright: 0, tension: 0, open: 0 });
  const engine = new AnalysisEngine({ sampleRate: 48000 });engine.setCalibration({ rms: .01, bands: {} });const noise = new Float32Array(48000 * 2).fill(.005);let frame;for (let i = 0; i < noise.length; i += 128) frame = engine.push(noise.subarray(i, i + 128)) || frame;assert.equal(frame.gate, true);assert.equal(engine.kickTimes.length + engine.snareTimes.length, 0);
});
