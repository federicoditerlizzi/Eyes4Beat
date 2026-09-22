import { AnalysisEngine } from './engine.js';

class EyesForBeatsAnalysisProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();const config = options.processorOptions || {};this.engine = new AnalysisEngine({ sampleRate, hopSize: config.hopSize || 512, fftSize: config.fftSize || 2048 });
    this.captureCalibration = false;
    this.port.onmessage = event => { if (event.data?.type === 'reset') this.engine.reset();if (event.data?.type === 'calibration') this.engine.setCalibration(event.data.value);if(event.data?.type === 'capture-calibration')this.captureCalibration=!!event.data.value; };
  }
  process(inputs) {
    const channels = inputs[0];if (!channels?.length) return true;const mono = new Float32Array(channels[0].length);
    for (let channel = 0; channel < channels.length; channel++) for (let index = 0; index < mono.length; index++) mono[index] += channels[channel][index] / channels.length;
    const features = this.engine.push(mono);if (features) { if(!this.captureCalibration)delete features.spectrum;this.port.postMessage(features); }return true;
  }
}
registerProcessor('eyesforbeats-analysis', EyesForBeatsAnalysisProcessor);
