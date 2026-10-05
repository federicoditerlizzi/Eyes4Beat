import { RealFFT, hann } from './fft.js';
import { BAND_DEFINITIONS, powerToDb } from './bands.js';
import { AdaptiveTrigger } from './onset.js';
import { AdaptiveNormalizer } from './normalize.js';
import { TempoTracker } from './tempo.js';
import { EventHistory } from './history.js';
const NORMALIZED = ['level','low','bright','motion','full'];
const BAND_NAMES = BAND_DEFINITIONS.map(band => band[0]);

// Compatibility views are created once; the audio path reads/writes typed storage.
// Avoid numeric helper call/return boxing in this hot path (covered by heap sampling).
function numericView(keys, values) {
  const view = {};for (let i = 0; i < keys.length; i++) Object.defineProperty(view, keys[i], { enumerable: true, get: () => values[i] });return view;
}
export class AnalysisEngine {
  constructor({ sampleRate, hopSize = 512, fftSize = 2048 }) {
    if (!sampleRate) throw new Error('sampleRate is required');this.sampleRate = sampleRate;this.hopSize = hopSize;this.fftSize = fftSize;this.rate = sampleRate / hopSize;this.window = hann(fftSize);this.buffer = new Float32Array(fftSize);this.writeIndex = 0;this.buffered = 0;this.frame = new Float32Array(fftSize);this.fft = new RealFFT(fftSize);this.samplesProcessed = 0;this.previousLog = new Float32Array(fftSize / 2 + 1);this.previousEnergy = 0;
    this.kickDetector = new AdaptiveTrigger({ historySize: Math.round(this.rate * 1.5), multiplier: 2.4, refractorySeconds: .06 });
    this.snareDetector = new AdaptiveTrigger({ historySize: Math.round(this.rate * 1.5), multiplier: 3.2, refractorySeconds: .15 });
    this.tempo = new TempoTracker(this.rate);this.normalizers = Object.fromEntries(['level','low','bright','motion','full'].map(key => [key, new AdaptiveNormalizer(this.rate, { minSpan: key === 'level' ? 18 : .25, responseScale: hopSize / 512 })]));
    this.calibration = null;this.kickBandState = { low: 0, high: 0 };this.lastKickEnvelope = 0;this.kicks = new EventHistory();this.snares = new EventHistory();this.rhythm = new EventHistory();
    this.cleanSpectrum = new Float64Array(fftSize / 2 + 1);this.logMagnitudes = new Float32Array(fftSize / 2 + 1);this.rangeSums = new Float64Array(10);
    this.eventValues = new Float64Array(3);this.metrics = new Float64Array(13);this.meterValues = new Float64Array(4);this.detectorValues = new Float64Array(4);this.cleanPowers = new Float64Array(7);this.rawValues = new Float64Array(7);this.bandValues = new Float64Array(7);this.bandPowerValues = new Float64Array(7);
    const ranges = [...BAND_DEFINITIONS.map(band => [band[1], band[2]]), [200, 400], [2000, 8000], [40, 110]], indices = [], weights = [];
    this.rangeOffsets = new Uint32Array(this.cleanSpectrum.length + 1);
    const hz = sampleRate / fftSize, nyquist = sampleRate / 2;
    for (let bin = 0; bin < this.cleanSpectrum.length; bin++) {
      this.rangeOffsets[bin] = indices.length;
      if (!bin) continue;
      for (let r = 0; r < ranges.length; r++) {
        const overlap = Math.max(0, Math.min(ranges[r][1], nyquist, (bin + .5) * hz) - Math.max(ranges[r][0], (bin - .5) * hz));
        if (overlap) { indices.push(r);weights.push(overlap / hz); }
      }
    }
    this.rangeOffsets[this.cleanSpectrum.length] = indices.length;this.rangeIndices = Uint8Array.from(indices);this.rangeWeights = Float64Array.from(weights);
    this.features = { raw: numericView(NORMALIZED, this.rawValues), rawValues: this.rawValues, bandValues: this.bandValues, bandPowerValues: this.bandPowerValues, events: numericView(['beat', 'kick', 'snare'], this.eventValues), eventValues:this.eventValues, tempo: this.tempo.result, gate: true,
      meter: numericView(['rms', 'peak', 'rmsDb', 'peakDb'], this.meterValues), meterValues: this.meterValues, bands: numericView(BAND_NAMES, this.bandValues),
      bandRanges: Object.fromEntries(BAND_DEFINITIONS.map(([name, low, high]) => [name, [low, Math.min(high, sampleRate / 2)]])),
      normalization: Object.fromEntries(NORMALIZED.map(name => [name, this.normalizers[name].range])), bandPowers: numericView(BAND_NAMES, this.bandPowerValues),
      detectors: numericView(['kickEnvelope', 'kickThreshold', 'snareFlux', 'snareThreshold'], this.detectorValues), spectrum: this.fft.power };
    Object.defineProperty(this.features, 'timestamp', { enumerable: true, get: () => this.metrics[0] });
    Object.defineProperty(this.features, 'onset', { enumerable: true, get: () => this.metrics[11] });
    this.kickEnvelopeValue = 0;this.kickMemory = .72 ** (hopSize / 512);this.lowAlpha = Math.exp(-2 * Math.PI * 110 / sampleRate);this.highAlpha = Math.exp(-2 * Math.PI * 40 / sampleRate);
  }
  setCalibration(calibration) { this.calibration = calibration || null; }
  migratePart(source, part) {
    const stride = this.hopSize / source.hopSize;
    if (part < NORMALIZED.length) {
      const key = NORMALIZED[part], dest = this.normalizers[key], src = source.normalizers[key];
      dest.history.copyFrom(src.history, stride);dest.recent.copyFrom(src.recent, stride);dest.output = src.output;dest.range.low = src.range.low;dest.range.high = src.range.high;
    } else if(part===5){return;
    } else if (part === 6) {
      this.kickDetector.history.copyFrom(source.kickDetector.history, stride);this.kickDetector.lastAt = source.kickDetector.lastAt;
      this.snareDetector.history.copyFrom(source.snareDetector.history, stride);this.snareDetector.lastAt = source.snareDetector.lastAt;
    } else if (part === 7) {
      const src = source.tempo, dest = this.tempo;dest.reset();dest.lastEstimate = Infinity;
      for (let i = 0; i < src.count; i += stride) dest.push(src.values[(src.head + i) % src.max], 0);
      dest.bpm = src.bpm;dest.confidence = src.confidence;dest.phase = src.phase;dest.nextBeat = src.nextBeat;dest.lastEstimate = src.lastEstimate;
    } else {
      // Preserve the input timeline and detector envelopes through mode changes.
      this.samplesProcessed = source.samplesProcessed + source.fftSize - this.fftSize;
      this.buffered = source.buffered + this.fftSize - source.fftSize;this.writeIndex = this.buffered;
      for (let i = 0; i < this.buffered; i++) this.buffer[i] = source.buffer[(source.writeIndex - this.buffered + source.fftSize + i) % source.fftSize];
      this.kickDetector.lastAt = source.kickDetector.lastAt;this.snareDetector.lastAt = source.snareDetector.lastAt;
      this.tempo.bpm = source.tempo.bpm;this.tempo.confidence = source.tempo.confidence;this.tempo.nextBeat = source.tempo.nextBeat;
      this.rawValues.set(source.rawValues);this.eventValues.set(source.eventValues);this.previousEnergy = source.previousEnergy;this.lastKickEnvelope = source.lastKickEnvelope;this.kickBandState.low = source.kickBandState.low;this.kickBandState.high = source.kickBandState.high;
      for (let i = 0; i < this.previousLog.length; i++) this.previousLog[i] = source.previousLog[Math.min(source.previousLog.length - 1, Math.round(i * source.fftSize / this.fftSize))];
      this.kicks.reset();this.snares.reset();this.rhythm.reset();
      for (let i = 0; i < source.kicks.length; i++) this.kicks.push(source.kicks.at(i));
      for (let i = 0; i < source.snares.length; i++) this.snares.push(source.snares.at(i));
      for (let i = 0; i < source.rhythm.length; i++) this.rhythm.push(source.rhythm.at(i));
    }
  }
  // Snapshots are for offline consumers only; the audio path uses the rings.
  get kickTimes() { return this.kicks.snapshot(); }
  get snareTimes() { return this.snares.snapshot(); }
  reset() {
    this.writeIndex = 0;this.buffered = 0;this.samplesProcessed = 0;this.previousLog.fill(0);this.previousEnergy = 0;this.tempo.reset();this.kickDetector.reset();this.snareDetector.reset();
    for (let i = 0; i < NORMALIZED.length; i++) this.normalizers[NORMALIZED[i]].reset();
    this.rawValues.fill(0);this.eventValues.fill(0);this.kickEnvelopeValue=0;
    this.kicks.reset();this.snares.reset();this.rhythm.reset();this.lastKickEnvelope = 0;this.kickBandState.low = 0;this.kickBandState.high = 0;
  }
  // Returned feature storage is borrowed until the next hop. Optional callback
  // consumes every hop even when an offline caller supplies a larger block.
  push(samples, onHop = null, channels = null) {
    let latest = null;
    for (let i = 0; i < samples.length; i++) {
      let value = samples[i];if (channels) { value = 0;for (let c = 0; c < channels.length; c++) value += channels[c][i] / channels.length; }this.buffer[this.writeIndex] = Number.isFinite(value) ? value : 0;this.writeIndex = (this.writeIndex + 1) % this.fftSize;this.buffered++;
      if (this.buffered === this.fftSize) {
        for (let j = 0; j < this.fftSize; j++) this.frame[j] = this.buffer[(this.writeIndex + j) % this.fftSize];
        latest = this.process(this.frame);if (onHop) onHop(latest);this.buffered -= this.hopSize;this.samplesProcessed += this.hopSize;
      }
    }
    return latest;
  }
  kickEnvelope(frame) {
    const lowAlpha = this.lowAlpha, highAlpha = this.highAlpha;let power = 0;
    for (let i = frame.length - this.hopSize; i < frame.length; i++) { const sample = frame[i];this.kickBandState.low = (1 - lowAlpha) * sample + lowAlpha * this.kickBandState.low;this.kickBandState.high = (1 - highAlpha) * sample + highAlpha * this.kickBandState.high;const band = this.kickBandState.low - this.kickBandState.high;power += band * band; }
    this.kickEnvelopeValue = Math.sqrt(power / this.hopSize);
  }
  analyzeFrame(frame) {
    let sum = 0, hopSum = 0, peak = 0;
    for (let i = 0; i < frame.length; i++) { const value = frame[i];sum += value * value;peak = Math.max(peak, Math.abs(value));if (i >= frame.length - this.hopSize) hopSum += value * value; }
    const time = (this.samplesProcessed + this.fftSize) / this.sampleRate, rawRms = Math.sqrt(sum / frame.length), spectrum = this.fft.transform(frame, this.window);
    const floorRms = this.calibration?.rms || 0, gated = rawRms <= floorRms * 1.5 || rawRms < 1e-5;
    const cleanRms = gated ? 0 : Math.sqrt(Math.max(0, rawRms ** 2 - floorRms ** 2));
    const floorBins = this.calibration?.bins, cleanSpectrum = this.cleanSpectrum, logMagnitudes = this.logMagnitudes, sums = this.rangeSums;
    sums.fill(0);let flux = 0, weighted = 0, magnitudeSum = 0, spectralPower=0, entropySum=0;
    for (let i = 0; i < spectrum.length; i++) {
      const power = Math.max(0, spectrum[i] - (floorBins?.[i] || 0) * 1.15);cleanSpectrum[i] = power;
      const magnitude = Math.sqrt(power);logMagnitudes[i] = Math.log1p(magnitude * 1000);
      flux += Math.max(0, logMagnitudes[i] - this.previousLog[i]);this.previousLog[i] = logMagnitudes[i];
      if(i&&power>0){spectralPower+=power;entropySum+=power*Math.log(power)}
      if (i) { magnitudeSum += magnitude;weighted += magnitude * i * this.sampleRate / this.fftSize; }
      for (let j = this.rangeOffsets[i]; j < this.rangeOffsets[i + 1]; j++) sums[this.rangeIndices[j]] += power * this.rangeWeights[j];
    }
    const powers = this.bandPowerValues, levels = this.bandValues, cleanPowers = this.cleanPowers;
    let totalPower = 0;
    for (let i = 0; i < BAND_NAMES.length; i++) { const name = BAND_NAMES[i];powers[i] = sums[i];levels[i] = powerToDb(sums[i]);cleanPowers[i] = Math.max(0, sums[i] - (floorBins ? 0 : (this.calibration?.bands?.[name] || 0)));totalPower += cleanPowers[i]; }
    const onsetRaw = gated ? 0 : flux / spectrum.length;
    if (!gated) this.kickEnvelope(frame);
    const hopRms = Math.sqrt(hopSum / this.hopSize), kickEnvelope = gated ? 0 : this.kickEnvelopeValue, kickRise = Math.max(0, kickEnvelope - this.lastKickEnvelope);this.lastKickEnvelope = this.lastKickEnvelope * this.kickMemory + kickEnvelope * (this.hopSize === 512 ? .28 : 1 - this.kickMemory);
    const metrics = this.metrics;
    metrics[0] = time;metrics[1] = rawRms;metrics[2] = cleanRms;metrics[3] = hopRms;metrics[4] = kickEnvelope;metrics[5] = kickRise;
    metrics[6] = onsetRaw;metrics[7] = totalPower;metrics[8] = magnitudeSum ? weighted / magnitudeSum : 0;metrics[9] = peak;metrics[10] = Number(gated);metrics[12]=spectralPower>0?Math.max(0,Math.min(1,(Math.log(spectralPower)-entropySum/spectralPower)/Math.log(spectrum.length-1))):0;
  }
  updateSources() {
    const gated=!!this.metrics[10],cleanRms=this.metrics[2],totalPower=this.metrics[7],centroid=this.metrics[8],onsetRaw=this.metrics[6],cleanPowers=this.cleanPowers,metrics=this.metrics;
    const raw=this.rawValues;
    if(gated)raw.fill(0);
    else{
      this.normalizers.level.input[0]=20*Math.log10(Math.max(1e-6,cleanRms));this.normalizers.level.update();raw[0]=this.normalizers.level.output;
      // Fixed physical ranges preserve spectral comparisons across isolated inputs.
      const lowDb=10*Math.log10((cleanPowers[0]+cleanPowers[1]+1e-12)/(totalPower+1e-12));
      raw[1]+= (Math.max(0,Math.min(1,(lowDb+60)/64))-raw[1])*.22;
      raw[2]+= (Math.max(0,Math.min(1,Math.log2(1+centroid/300)/Math.log2(1+this.sampleRate/600)))-raw[2])*.22;
      raw[3]+= (onsetRaw/(onsetRaw+.08)-raw[3])*.3;
      raw[4]+= (metrics[12]-raw[4])*.22;
    }
  }
  process(frame) {
    this.analyzeFrame(frame);
    const metrics = this.metrics, time = metrics[0], rawRms = metrics[1], cleanRms = metrics[2], hopRms = metrics[3], kickEnvelope = metrics[4], kickRise = metrics[5];
    const onsetRaw = metrics[6], totalPower = metrics[7], centroid = metrics[8], peak = metrics[9], gated = !!metrics[10], sums = this.rangeSums, cleanPowers = this.cleanPowers;
    this.kickDetector.input[0] = kickEnvelope;this.kickDetector.input[1] = time;this.kickDetector.update();
    const kickResult = this.kickDetector.result;
    const body = sums[7], noise = sums[8], snareValue = gated ? 0 : onsetRaw * Math.sqrt(Math.max(0, body + noise * 1.4));
    const kickSpectrum = sums[9];
    this.snareDetector.input[0] = snareValue;this.snareDetector.input[1] = time;this.snareDetector.update();
    const snareResult = this.snareDetector.result, kick = gated ? false : kickResult.trigger && kickRise > 0 && kickEnvelope > hopRms * .16, snare = gated ? false : snareResult.trigger && noise > cleanPowers[1] * 1.2 && kickSpectrum < body + noise;
    this.kicks.input[0] = time;this.snares.input[0] = time;this.rhythm.input[0] = time;
    this.kicks.append(kick);this.snares.append(snare);this.rhythm.append(kick);this.rhythm.append(snare);
    this.kicks.expire();this.snares.expire();this.rhythm.expire();
    const onset = Math.max(0, Math.min(1, onsetRaw * 7));this.tempo.input[0] = onset;this.tempo.input[1] = time;this.tempo.update();
    const tempo = this.tempo.result;
    this.updateSources();
    const features=this.features;
    this.eventValues[0]=tempo.beat?1:0;
    this.eventValues[1]=kick?kickEnvelope/(kickEnvelope+Math.max(.01,kickResult.threshold)*4):0;
    this.eventValues[2]=snare?snareValue/(snareValue+Math.max(.0005,snareResult.threshold)*4):0;
    this.metrics[11]=onset;features.gate=gated;
    this.meterValues[0] = rawRms;this.meterValues[1] = peak;this.meterValues[2] = (rawRms > 1e-6 ? Math.max(-120, 20 * Math.log10(rawRms)) : -120);this.meterValues[3] = (peak > 1e-6 ? Math.max(-120, 20 * Math.log10(peak)) : -120);
    this.detectorValues[0] = kickEnvelope;this.detectorValues[1] = kickResult.threshold;this.detectorValues[2] = snareValue;this.detectorValues[3] = snareResult.threshold;
    return features;
  }
}
