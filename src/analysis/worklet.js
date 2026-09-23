import { AnalysisEngine } from './engine.js';
import { MusicalLayers } from './layers.js';
import { FeatureBatch, PAYLOAD_SIZE, DIAGNOSTIC_SIZE, writeDiagnostics } from './messages.js';
import { LoadMonitor } from './load-monitor.js';

const now = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : Date.now;
const clock = globalThis.performance?.now ? 'high-resolution' : 'millisecond';
class EyesForBeatsAnalysisProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();const config = options.processorOptions || {};
    this.engines = [new AnalysisEngine({ sampleRate, hopSize: config.hopSize || 512, fftSize: config.fftSize || 2048 }), new AnalysisEngine({ sampleRate, hopSize: 1024, fftSize: 2048 }), new AnalysisEngine({ sampleRate, hopSize: 1024, fftSize: 1024 })];
    this.engine = this.engines[0];this.layers = new MusicalLayers(sampleRate / 512);this.batch = new FeatureBatch();this.monitor = new LoadMonitor(sampleRate);this.mode = 0;this.migrationPart = -1;
    this.captureCalibration = false;this.calibrationFinishing = false;this.diagnostics = false;this.latest = null;this.nextMessage = 0;this.nextDiagnostic = 0;this.nextCalibration = 0;this.nextSlot = 0;
    this.slots = [new Float32Array(PAYLOAD_SIZE), new Float32Array(PAYLOAD_SIZE)];
    this.diagnosticSlots = [new Float32Array(DIAGNOSTIC_SIZE), new Float32Array(DIAGNOSTIC_SIZE)];
    this.calibrationSlots = [new Float32Array(1025), new Float32Array(1025)];this.calibrationSum = new Float64Array(1025);this.calibrationCount = 0;this.calibrationPower = 0;
    this.message = { type: 'features', slot: 0, payload: null, timestamp: 0, origin: 0, count: 0, processingMs: 0, mode: 0, clock, overflow: false, overloaded: false };
    this.diagnosticMessage = { type: 'diagnostics', slot: 0, payload: null, bins: 0 };
    this.calibrationMessage = { type: 'calibration-sample', slot: 0, payload: null, bins: 0, count: 0, power: 0, fftSize: 2048, final: false };
    this.transfers = [null];
    this.onHop = features => {
      this.latest = features;this.layers.push(features, this.engine.hopSize / 512);this.batch.add(features);
      if (this.captureCalibration) {
        this.calibrationCount++;this.calibrationPower += features.meter.rms ** 2;
        for (let i = 0; i < features.spectrum.length; i++) this.calibrationSum[i] += features.spectrum[i];
      }
    };
    this.port.onmessage = event => this.receive(event.data);
  }
  receive(data) {
    if (data.type === 'recycle') {
      const slots = data.kind === 'features' ? this.slots : data.kind === 'diagnostics' ? this.diagnosticSlots : this.calibrationSlots;
      if (data.slot >= 0 && data.slot < 2 && !slots[data.slot]) slots[data.slot] = data.payload;
      if (this.calibrationFinishing) this.flushCalibration(true);
    }
    if (data.type === 'reset') { for (let i = 0; i < 3; i++) this.engines[i].reset();if(data.resetLayers)this.layers.reset();else this.layers.rebase();this.layers.kick=0;this.layers.snare=0;this.layers.beat=0;this.batch.reset();this.latest = null;this.nextMessage = 0;this.nextDiagnostic = 0;this.nextCalibration = 0;this.migrationPart = -1;this.monitor.mode = this.mode;this.clearCalibration();this.calibrationFinishing = false; }
    if (data.type === 'calibration') {
      for (let i = 0; i < 3; i++) {
        const engine = this.engines[i], value = data.value;
        if (!value?.bins?.length) { engine.setCalibration(value);continue; }
        const bins = new Float64Array(engine.fftSize / 2 + 1), sourceSize = (value.bins.length - 1) * 2;
        // Rebin calibration power by physical bin overlap when the FFT changes.
        const scale = sourceSize / engine.fftSize;
        for (let bin = 0; bin < bins.length; bin++) {
          const low = Math.max(0, (bin - .5) * scale), high = Math.min(sourceSize / 2, (bin + .5) * scale);
          for (let j = Math.max(0, Math.floor(low)); j <= Math.min(value.bins.length - 1, Math.ceil(high)); j++) bins[bin] += value.bins[j] * Math.max(0, Math.min(high, j + .5) - Math.max(low, j - .5));
        }
        // Identical sizes preserve the endpoint bins exactly.
        if (sourceSize === engine.fftSize) bins.set(value.bins);
        engine.setCalibration({ rms: value.rms, bands: value.bands, bins });
      }
    }
    if (data.type === 'capture-calibration') {
      this.captureCalibration = !!data.value;this.calibrationFinishing = !data.value;
      if (data.value) { this.clearCalibration();this.nextCalibration = 0; }
      else this.flushCalibration(true);
    }
    if (data.type === 'diagnostics') this.diagnostics = !!data.value;
  }
  clearCalibration() { this.calibrationSum.fill(0);this.calibrationCount = 0;this.calibrationPower = 0; }
  flushCalibration(final = false) {
    const slot = this.calibrationSlots[0] ? 0 : 1;
    if (!this.calibrationSlots[slot]) return;
    const bins = this.engine.fftSize / 2 + 1;
    for (let i = 0; i < bins; i++) this.calibrationSlots[slot][i] = this.calibrationSum[i];
    const message = this.calibrationMessage;message.bins = bins;message.count = this.calibrationCount;message.power = this.calibrationPower;message.fftSize = this.engine.fftSize;message.final = final;
    this.send(message, this.calibrationSlots, slot);this.clearCalibration();this.calibrationFinishing = false;
    this.nextCalibration = (this.latest?.timestamp || 0) + .1;
  }
  send(message, slots, slot) {
    message.slot = slot;message.payload = slots[slot];this.transfers[0] = message.payload.buffer;
    this.port.postMessage(message, this.transfers);slots[slot] = null;message.payload = null;this.transfers[0] = null;
  }
  process(inputs) {
    const channels = inputs[0];if (!channels?.length) return true;
    const started = now();
    this.engine.push(channels[0], this.onHop, channels);
    const features = this.latest;
    if (features && features.timestamp >= this.nextMessage) {
      const slot = this.slots[this.nextSlot] ? this.nextSlot : 1 - this.nextSlot;
      if (this.slots[slot]) {
        const message = this.message;message.origin = this.batch.write(this.slots[slot], features, this.layers);message.count = this.batch.count;message.timestamp = features.timestamp;
        message.processingMs = this.monitor.averageMs;message.mode = this.mode;message.overflow = this.batch.overflow;message.overloaded = this.monitor.overloaded;
        this.send(message, this.slots, slot);this.nextSlot = 1 - slot;this.batch.reset();this.nextMessage = Math.max(this.nextMessage + .02, features.timestamp + 1e-9);
      }
    }
    if (features && this.diagnostics && features.timestamp >= this.nextDiagnostic) {
      const slot = this.diagnosticSlots[0] ? 0 : 1;
      if (this.diagnosticSlots[slot]) { writeDiagnostics(this.diagnosticSlots[slot], features);this.diagnosticMessage.bins = features.spectrum.length;this.send(this.diagnosticMessage, this.diagnosticSlots, slot);this.nextDiagnostic = features.timestamp + .1; }
    }
    if (features && this.captureCalibration && this.calibrationCount && features.timestamp >= this.nextCalibration) this.flushCalibration();
    // Each normalizer migrates in a separate quantum; constructors never run here.
    if (this.migrationPart >= 0 && features && !this.captureCalibration && !this.calibrationFinishing) {
      this.engines[this.mode + 1].migratePart(this.engine, this.migrationPart++);
      if (this.migrationPart > 8) { this.mode++;this.engine = this.engines[this.mode];this.latest = null;this.migrationPart = -1; }
    }
    // Keep a calibration capture at one resolution until it completes.
    if (this.monitor.observe(now() - started, channels[0].length) && !this.captureCalibration && !this.calibrationFinishing && this.migrationPart < 0) this.migrationPart = 0;
    if (this.captureCalibration || this.calibrationFinishing) this.monitor.mode = this.mode;
    return true;
  }
}
registerProcessor('eyesforbeats-analysis', EyesForBeatsAnalysisProcessor);
