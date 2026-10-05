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
  const averageActive = gain => { const result = run(kickTrain(48000, 120, 14, gain), 48000);const active = result.frames.slice(-400).filter(frame => !frame.gate);return active.reduce((sum, frame) => sum + frame.raw.level, 0) / active.length; };
  const quiet = averageActive(.1), loud = averageActive(.5), full = averageActive(1);assert.ok(Math.abs(quiet - loud) < .18);assert.ok(full < .9);
});

test('silence and calibrated noise floor produce zero states and no events', () => {
  const silent = run(new Float32Array(48000 * 3), 48000);assert.deepEqual(silent.last.raw, {level:0,low:0,bright:0,motion:0,full:0});
  const engine = new AnalysisEngine({ sampleRate: 48000 });engine.setCalibration({ rms: .01, bands: {} });const noise = new Float32Array(48000 * 2).fill(.005);let frame;for (let i = 0; i < noise.length; i += 128) frame = engine.push(noise.subarray(i, i + 128)) || frame;assert.equal(frame.gate, true);assert.equal(engine.kickTimes.length + engine.snareTimes.length, 0);
});

test('independent spectral sources separate bass and high frequencies and remain normalized',()=>{
 const tone=(hz)=>Float32Array.from({length:48000*3},(_,i)=>.3*Math.sin(2*Math.PI*hz*i/48000));
 const bass=run(tone(80),48000).last.raw,hat=run(tone(8000),48000).last.raw;
 assert.ok(bass.low>.8&&hat.low<.1,JSON.stringify({bass,hat}));assert.ok(hat.bright>bass.bright+.5);
 for(const value of Object.values({...bass,...hat}))assert.ok(value>=0&&value<=1);
 assert.ok(Object.values(bass).every(v=>v<.99));
});
test('motion responds to a transient and settles on a steady tone',()=>{
 const signal=new Float32Array(48000*4);for(let i=48000;i<signal.length;i++)signal[i]=.4*Math.sin(2*Math.PI*440*i/48000);
 const {frames}=run(signal,48000),attack=frames.filter(f=>f.timestamp>1&&f.timestamp<1.2).map(f=>f.raw.motion),steady=frames.filter(f=>f.timestamp>3).map(f=>f.raw.motion);
 assert.ok(Math.max(...attack)>.1);assert.ok(steady.reduce((a,b)=>a+b)/steady.length<Math.max(...attack)*.2);
});
test('fullness distinguishes noise from a sine and has continuous intermediate values',()=>{
 let seed=42;const signal=new Float32Array(48000*5);for(let i=0;i<signal.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const blend=i/signal.length;signal[i]=.3*((1-blend)*Math.sin(2*Math.PI*440*i/48000)+blend*(seed/2**31-1))}
 const {frames}=run(signal,48000),values=frames.map(f=>f.raw.full);
 assert.ok(values.at(-1)>values[40]+.4);assert.ok(new Set(values.map(v=>v.toFixed(3))).size>100);
 assert.ok(values.every(v=>v>=0&&v<=1));assert.ok(values.slice(1).every((v,i)=>Math.abs(v-values[i])<.1));
});
test('kick and snare publish intensity proportional to hit strength',()=>{
 const maxima=(signal,key)=>Math.max(...run(signal,48000).frames.map(f=>f.events[key]));
 for(const [key,signal] of [['kick',kickTrain(48000,120,4)],['snare',snareTrain(48000,4)]]){
  const soft=maxima(Float32Array.from(signal,v=>v*.2),key),loud=maxima(signal,key);assert.ok(soft>0&&loud>soft&&loud<=1,`${key}: ${soft}, ${loud}`);
 }
});
