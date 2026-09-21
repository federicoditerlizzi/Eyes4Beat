import test from 'node:test';
import assert from 'node:assert/strict';
import { averageNoiseFloor, computeDbfsMeter, dbToGain, gainToDb, spectralSubtract, subtractRmsNoise } from '../src/input-calibration.js';

test('dB and gain conversions round-trip', () => {
  for (const db of [-24, -6, 0, 12, 24]) assert.ok(Math.abs(gainToDb(dbToGain(db)) - db) < 1e-10);
  assert.equal(dbToGain(0), 1);
});

test('dBFS meter computes RMS and peak from byte time-domain data', () => {
  const meter = computeDbfsMeter(Uint8Array.from([128, 192, 128, 64]));
  assert.equal(meter.peak, .5);
  assert.ok(Math.abs(meter.rms - Math.sqrt(.125)) < 1e-12);
  assert.ok(Math.abs(meter.peakDb - (-6.020599913279624)) < 1e-10);
});

test('noise floor averaging returns mean RMS and bins', () => {
  const result = averageNoiseFloor([
    { rms: .1, bins: Uint8Array.from([2, 4, 6]) },
    { rms: .3, bins: Uint8Array.from([4, 8, 10]) },
  ]);
  assert.equal(result.rms, .2);
  assert.deepEqual([...result.bins], [3, 6, 8]);
});

test('spectral subtraction clamps at zero without mutating input', () => {
  const input = Uint8Array.from([3, 12, 30]);
  const before = Uint8Array.from(input);
  const output = spectralSubtract(input, Float32Array.from([2, 5, 20]), 3);
  assert.deepEqual([...output], [0, 4, 7]);
  assert.deepEqual(input, before);
});

test('RMS subtraction uses power domain and gates near-floor signals', () => {
  assert.equal(subtractRmsNoise(.014, .01), 0);
  assert.ok(Math.abs(subtractRmsNoise(.02, .01) - Math.sqrt(.0003)) < 1e-12);
});
