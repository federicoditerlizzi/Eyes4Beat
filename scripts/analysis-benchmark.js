import { Session } from 'node:inspector';
import { performance } from 'node:perf_hooks';
import { AnalysisEngine } from '../src/analysis/engine.js';
import { MusicalLayers } from '../src/analysis/layers.js';
import { FeatureBatch, PAYLOAD_SIZE } from '../src/analysis/messages.js';

const rate = 48000, signal = new Float32Array(rate * 4);
for (let i = 0; i < signal.length; i++) {
  const t = i / rate, beat = t % .5, snare = (t + .25) % .5;
  signal[i] = .12 * Math.sin(t * 2 * Math.PI * 220) + .08 * Math.sin(t * 2 * Math.PI * 523.25)
    + .6 * Math.sin(beat * 2 * Math.PI * 60) * Math.exp(-beat / .025)
    + .13 * (Math.sin(t * 2 * Math.PI * 3200) + Math.sin(t * 2 * Math.PI * 5700)) * Math.exp(-snare / .035);
}
const blocks = Array.from({ length: signal.length / 128 }, (_, i) => signal.subarray(i * 128, (i + 1) * 128));
const engine = new AnalysisEngine({ sampleRate: rate }), layers = new MusicalLayers(rate / 512), batch = new FeatureBatch(), payload = new Float32Array(PAYLOAD_SIZE);
let hops = 0;
const onHop = features => { layers.push(features);batch.add(features);if (++hops % 2 === 0) { batch.write(payload, features, layers);batch.reset(); } };
// Fill the complete 60-second histories and warm the infrequent tempo-estimate path.
for (let i = 0; i < 120000; i++) engine.push(blocks[i % blocks.length], onHop);
const feature = engine.features, spectrum = feature.spectrum, raw = feature.raw;
const durations = new Float64Array(12000);
global.gc();const before = process.memoryUsage().heapUsed;
// No timing calls inside this pass: do not attribute timer boxing to the DSP.
for (let i = 0; i < 12000; i++) engine.push(blocks[(120000 + i) % blocks.length], onHop);
const peakGrowth = process.memoryUsage().heapUsed - before;
global.gc();const retainedGrowth = process.memoryUsage().heapUsed - before;
for (let i = 0; i < durations.length; i++) { const start = performance.now();engine.push(blocks[(132000 + i) % blocks.length], onHop);durations[i] = performance.now() - start; }
let sum = 0, max = 0, spikes = 0;
for (let i = 0; i < durations.length; i++) { sum += durations[i];max = Math.max(max, durations[i]);if (durations[i] > .5) spikes++; }
// Sample collected allocations too: before/after GC alone only detects leaks.
const inspector = new Session();inspector.connect();
const inspect = (method, params = {}) => new Promise((resolve, reject) => inspector.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
await inspect('HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
for (let i = 0; i < 20000; i++) engine.push(blocks[(144000 + i) % blocks.length], onHop);
const { profile } = await inspect('HeapProfiler.stopSampling');inspector.disconnect();
let sampledAllocationBytes = 0;
function countAllocations(node, inAnalysis = false) {
  inAnalysis ||= node.callFrame.url.includes('/src/analysis/');
  if (inAnalysis) sampledAllocationBytes += node.selfSize;
  for (const child of node.children) countAllocations(child, inAnalysis);
}
countAllocations(profile.head);
console.log(JSON.stringify({ averageMs: sum / durations.length, maxMs: max, spikes, sampledAllocationBytes, peakGrowth, retainedGrowth, reused: feature === engine.features && spectrum === engine.features.spectrum && raw === engine.features.raw }));
