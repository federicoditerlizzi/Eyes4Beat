import { fftReal, hann } from './fft.js';
import { BAND_DEFINITIONS, amplitudeToDb, bandPowers, rangePower, spectralCentroid } from './bands.js';
import { AdaptiveTrigger, spectralFlux } from './onset.js';
import { AdaptiveNormalizer } from './normalize.js';
import { TempoTracker } from './tempo.js';

const clamp = value => Math.max(0, Math.min(1, value));
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
function rhythmRegularity(times, bpm) {
  if (times.length < 3 || !bpm) return clamp(times.length / 6) * .25;
  const beat = 60 / bpm, intervals = times.slice(1).map((time,index)=>time-times[index]), scores = intervals.map(interval=>{const grid=Math.max(.5,Math.round(interval/beat*2)/2);return clamp(1-Math.abs(interval-grid*beat)/(beat*.25));});
  return scores.reduce((sum,value)=>sum+value,0)/scores.length*clamp(times.length/8);
}
export class AnalysisEngine {
  constructor({ sampleRate, hopSize = 512, fftSize = 2048 }) {
    if (!sampleRate) throw new Error('sampleRate is required');this.sampleRate = sampleRate;this.hopSize = hopSize;this.fftSize = fftSize;this.rate = sampleRate / hopSize;this.window = hann(fftSize);this.buffer = [];this.samplesProcessed = 0;this.previousLog = null;this.previousEnergy = 0;
    this.kickDetector = new AdaptiveTrigger({ historySize: Math.round(this.rate * 1.5), multiplier: 2.4, refractorySeconds: .06 });
    this.snareDetector = new AdaptiveTrigger({ historySize: Math.round(this.rate * 1.5), multiplier: 3.2, refractorySeconds: .15 });
    this.tempo = new TempoTracker(this.rate);this.normalizers = Object.fromEntries(['energy','density','drive','boombap','bright','tension'].map(key => [key, new AdaptiveNormalizer(this.rate, { minSpan: key === 'energy' ? 18 : .25 })]));
    this.calibration = null;this.kickBandState = { low: 0, high: 0 };this.lastKickEnvelope = 0;this.kickTimes = [];this.snareTimes = [];
  }
  setCalibration(calibration) { this.calibration = calibration || null; }
  reset() { this.buffer.length = 0;this.samplesProcessed = 0;this.previousLog = null;this.previousEnergy = 0;this.tempo.reset();this.kickDetector.reset();this.snareDetector.reset();Object.values(this.normalizers).forEach(item => item.reset()); }
  push(samples) {
    for (const value of samples) this.buffer.push(Number.isFinite(value) ? value : 0);let latest = null;
    while (this.buffer.length >= this.fftSize) { latest = this.process(Float32Array.from(this.buffer.slice(0, this.fftSize)));this.buffer.splice(0, this.hopSize);this.samplesProcessed += this.hopSize; }
    return latest;
  }
  kickEnvelope(frame) {
    const lowAlpha = Math.exp(-2 * Math.PI * 110 / this.sampleRate), highAlpha = Math.exp(-2 * Math.PI * 40 / this.sampleRate);let power = 0;
    for (const sample of frame) { this.kickBandState.low = (1 - lowAlpha) * sample + lowAlpha * this.kickBandState.low;this.kickBandState.high = (1 - highAlpha) * sample + highAlpha * this.kickBandState.high;const band = this.kickBandState.low - this.kickBandState.high;power += band * band; }
    return Math.sqrt(power / frame.length);
  }
  process(frame) {
    const time = (this.samplesProcessed + this.fftSize) / this.sampleRate, rawRms = rms(frame), spectrum = fftReal(frame, this.window);
    const floorRms = this.calibration?.rms || 0, gated = rawRms <= floorRms * 1.5 || rawRms < 1e-5;
    const cleanRms = gated ? 0 : Math.sqrt(Math.max(0, rawRms ** 2 - floorRms ** 2));
    const floorBins = this.calibration?.bins, cleanSpectrum = Float64Array.from(spectrum, (power,index) => Math.max(0, power - (floorBins?.[index] || 0) * 1.15));
    const { powers, levels } = bandPowers(cleanSpectrum, this.sampleRate, this.fftSize), cleanPowers = {};
    for (const [name] of BAND_DEFINITIONS) cleanPowers[name] = Math.max(0, powers[name] - (floorBins ? 0 : (this.calibration?.bands?.[name] || 0)));
    const logMagnitudes = Float32Array.from(cleanSpectrum, power => Math.log1p(Math.sqrt(power) * 1000)), onsetRaw = gated ? 0 : spectralFlux(logMagnitudes, this.previousLog);this.previousLog = logMagnitudes;
    const newSamples = frame.subarray(frame.length - this.hopSize), hopRms = rms(newSamples), kickEnvelope = gated ? 0 : this.kickEnvelope(newSamples), kickRise = Math.max(0, kickEnvelope - this.lastKickEnvelope);this.lastKickEnvelope = this.lastKickEnvelope * .72 + kickEnvelope * .28;
    const kickResult = this.kickDetector.push(kickEnvelope, time);
    const body = rangePower(cleanSpectrum, this.sampleRate, this.fftSize, 200, 400), noise = rangePower(cleanSpectrum, this.sampleRate, this.fftSize, 2000, 8000), snareValue = gated ? 0 : onsetRaw * Math.sqrt(Math.max(0, body + noise * 1.4));
    const kickSpectrum = rangePower(cleanSpectrum, this.sampleRate, this.fftSize, 40, 110);
    const snareResult = this.snareDetector.push(snareValue, time), kick = gated ? false : kickResult.trigger && kickRise > 0 && kickEnvelope > hopRms * .16, snare = gated ? false : snareResult.trigger && noise > cleanPowers.bass * 1.2 && kickSpectrum < body + noise;
    if (kick) this.kickTimes.push(time);if (snare) this.snareTimes.push(time);this.kickTimes = this.kickTimes.filter(value => value > time - 8);this.snareTimes = this.snareTimes.filter(value => value > time - 8);
    const onset = clamp(onsetRaw * 7), tempo = this.tempo.push(onset, time);
    const totalPower = Object.values(cleanPowers).reduce((a, b) => a + b, 0), activeBands = Object.values(cleanPowers).filter(value => value > totalPower * .035).length;
    const densityRaw = gated ? 0 : activeBands / BAND_DEFINITIONS.length;
    const energyDb = amplitudeToDb(cleanRms), energyRaw = gated ? -120 : energyDb;
    const energyChange = Math.abs(energyDb - this.previousEnergy);this.previousEnergy = energyDb;
    const lowPush = 10 * Math.log10((cleanPowers.sub + cleanPowers.bass + 1e-12) / (totalPower + 1e-12));
    const centroid = spectralCentroid(cleanSpectrum, this.sampleRate, this.fftSize), brightRaw = gated ? 0 : Math.log2(1 + centroid / 300);
    const imbalance = 10 * Math.log10((cleanPowers.lowMid + cleanPowers.mid + 1e-12) / (cleanPowers.sub + cleanPowers.bass + 1e-12));
    const regularity = rhythmRegularity([...this.kickTimes,...this.snareTimes].sort((a,b)=>a-b),tempo.bpm), raw = {
      energy: gated ? 0 : this.normalizers.energy.push(energyRaw), density: gated ? 0 : this.normalizers.density.push(densityRaw),
      drive: gated ? 0 : this.normalizers.drive.push(energyChange * .1 + Math.max(0, lowPush + 16) / 16),
      boombap: gated ? 0 : this.normalizers.boombap.push(tempo.confidence * .7 + regularity * .3),
      bright: gated ? 0 : this.normalizers.bright.push(brightRaw), tension: gated ? 0 : this.normalizers.tension.push(onset * .65 + clamp((imbalance + 12) / 24) * .35),
    };
    raw.open = gated ? 0 : clamp(1 - raw.density * .62 - raw.tension * .38);
    return { timestamp: time, raw, events: { beat: tempo.beat, kick, snare }, tempo, onset, gate: gated,
      meter: { rms: rawRms, peak: frame.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0), rmsDb: amplitudeToDb(rawRms), peakDb: amplitudeToDb(frame.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)) },
      bands: levels, bandRanges: Object.fromEntries(BAND_DEFINITIONS.map(([name, low, high]) => [name, [low, Math.min(high, this.sampleRate / 2)]])),
      normalization: Object.fromEntries(Object.entries(this.normalizers).map(([name, item]) => [name, item.range])), bandPowers: powers,
      detectors: { kickEnvelope, kickThreshold: kickResult.threshold, snareFlux: snareValue, snareThreshold: snareResult.threshold }, spectrum };
  }
}
