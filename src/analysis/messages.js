import { FEATURE_KEYS } from './layers.js';
import { BAND_DEFINITIONS } from './bands.js';

// Float32 layout: raw[7], Fast[7], Context[7], tempo[3], onset/gate,
// meter[4], rhythm envelopes[3], followed by event (type, seconds-offset) pairs.
// Absolute timestamps stay double-precision plain numbers, including long shows.
export const EVENT_OFFSET = 33;
export const EVENT_CAPACITY = 4096;
export const PAYLOAD_SIZE = EVENT_OFFSET + EVENT_CAPACITY * 2;
export const EVENT_NAMES = ['kick', 'snare', 'beat'];
export const DIAGNOSTIC_OFFSET = 32;
export const DIAGNOSTIC_SIZE = DIAGNOSTIC_OFFSET + 1025;

export class FeatureBatch {
  constructor() {
    this.times = new Float64Array(EVENT_CAPACITY);this.types = new Uint8Array(EVENT_CAPACITY);this.count = 0;
    this.overflow = false;
  }
  reset() { this.count = 0;this.overflow = false; }
  add(features) {
    for (let i = 0; i < EVENT_NAMES.length; i++) if (features.events[EVENT_NAMES[i]]) {
      if (this.count === EVENT_CAPACITY) { this.overflow = true;return; }
      this.times[this.count] = features.timestamp;this.types[this.count++] = i;
    }
  }
  write(payload, features, layers) {
    for (let i = 0; i < 7; i++) { payload[i] = features.rawValues[i];payload[7 + i] = layers.fast[i];payload[14 + i] = layers.context[i]; }
    payload[21] = features.tempo.bpm;payload[22] = features.tempo.confidence;payload[23] = features.tempo.phase;
    payload[24] = features.onset;payload[25] = Number(features.gate);
    payload[26] = features.meter.rms;payload[27] = features.meter.peak;payload[28] = features.meter.rmsDb;payload[29] = features.meter.peakDb;
    payload[30] = layers.kick;payload[31] = layers.snare;payload[32] = layers.beat;
    const origin = this.count ? this.times[0] : features.timestamp;
    for (let i = 0; i < this.count; i++) { payload[EVENT_OFFSET + i * 2] = this.types[i];payload[EVENT_OFFSET + i * 2 + 1] = this.times[i] - origin; }
    return origin;
  }
}

// Main-thread decoding owns its objects; the transferable is returned immediately.
export function decodeFeatures(message) {
  const p = message.payload, raw = {}, fast = {}, context = {}, events = { kick: false, snare: false, beat: false }, eventBatch = [];
  for (let i = 0; i < 7; i++) { raw[FEATURE_KEYS[i]] = p[i];fast[FEATURE_KEYS[i]] = p[7 + i];context[FEATURE_KEYS[i]] = p[14 + i]; }
  for (let i = 0; i < message.count; i++) {
    const type = EVENT_NAMES[p[EVENT_OFFSET + i * 2]], timestamp = message.origin + p[EVENT_OFFSET + i * 2 + 1];
    eventBatch.push({ type, timestamp });events[type] = true;
  }
  return { timestamp: message.timestamp, raw, fast, context, events, eventBatch,
    tempo: { bpm: p[21], confidence: p[22], phase: p[23] }, onset: p[24], gate: !!p[25],
    meter: { rms: p[26], peak: p[27], rmsDb: p[28], peakDb: p[29] }, kick: p[30], snare: p[31], beat: p[32],
    processingMs: message.processingMs, mode: message.mode, clock: message.clock, overflow: message.overflow, overloaded: message.overloaded };
}
export function writeDiagnostics(payload, features) {
  for (let i = 0; i < BAND_DEFINITIONS.length; i++) { const name = BAND_DEFINITIONS[i][0];payload[i] = features.bandValues[i];payload[7 + i] = features.bandPowerValues[i]; }
  for (let i = 0; i < 6; i++) { const range = features.normalization[FEATURE_KEYS[i]];payload[14 + i * 2] = range.low;payload[15 + i * 2] = range.high; }
  payload[26] = features.detectors.kickEnvelope;payload[27] = features.detectors.kickThreshold;payload[28] = features.detectors.snareFlux;payload[29] = features.detectors.snareThreshold;
  payload.set(features.spectrum, DIAGNOSTIC_OFFSET);
}
export function decodeDiagnostics(message, sampleRate) {
  const p = message.payload, bands = {}, bandPowers = {}, bandRanges = {}, normalization = {};
  for (let i = 0; i < 7; i++) { const [name, low, high] = BAND_DEFINITIONS[i];bands[name] = p[i];bandPowers[name] = p[7 + i];bandRanges[name] = [low, Math.min(high, sampleRate / 2)]; }
  for (let i = 0; i < 6; i++) normalization[FEATURE_KEYS[i]] = { low: p[14 + i * 2], high: p[15 + i * 2] };
  return { bands, bandPowers, bandRanges, normalization, detectors: { kickEnvelope: p[26], kickThreshold: p[27], snareFlux: p[28], snareThreshold: p[29] }, spectrum: p.slice(DIAGNOSTIC_OFFSET, DIAGNOSTIC_OFFSET + message.bins) };
}
