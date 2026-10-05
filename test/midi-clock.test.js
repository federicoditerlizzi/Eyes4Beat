import test from 'node:test';
import assert from 'node:assert/strict';
import {MidiClock,parseMidiMessage,resolveInputTempo} from '../src/midi/clock.js';
const receive=(clock,status,time)=>clock.receive(parseMidiMessage([status],time));
for(const bpm of [90,120,140])test(`${bpm} BPM clock: 24 ppqn, jitter smoothing and phase from event timestamps`,()=>{
 const clock=new MidiClock(),period=60000/(bpm*24);receive(clock,0xfa,900);
 let last=0;
 for(let tick=0;tick<24*20+7;tick++){
  last=1000+tick*period+Math.sin(tick*1.7)*1.5;receive(clock,0xf8,last);
 }
 const snapshot=clock.snapshot(last);assert.ok(snapshot.present);assert.ok(Math.abs(snapshot.bpm-bpm)<.3,snapshot.bpm);
 assert.ok(Math.abs(snapshot.phase-.25)<1e-10,snapshot.phase);
 // Arrival can be late. Parsing is still timed by the event timestamp.
 assert.ok(clock.snapshot(last+250).present);assert.equal(clock.bpm,snapshot.bpm);
});
test('start resets position; stop freezes phase; continue resumes without resetting',()=>{
 const clock=new MidiClock();receive(clock,0xfa,0);for(let i=0;i<13;i++)receive(clock,0xf8,10+i*20);
 assert.equal(clock.snapshot(250).phase,.5);receive(clock,0xfc,251);for(let i=0;i<8;i++)receive(clock,0xf8,270+i*20);
 assert.equal(clock.snapshot(450).phase,.5);assert.equal(clock.snapshot(450).running,false);
 receive(clock,0xfb,451);receive(clock,0xf8,470);assert.equal(clock.snapshot(470).phase,13/24);receive(clock,0xf8,490);assert.equal(clock.snapshot(490).phase,14/24);
 receive(clock,0xfa,491);receive(clock,0xf8,510);assert.equal(clock.snapshot(510).phase,0);
});
test('fresh MIDI clock overrides audio and falls back after one second, including a new clock train',()=>{
 const clock=new MidiClock();receive(clock,0xfa,0);for(let i=0;i<49;i++)receive(clock,0xf8,i*60000/(120*24));
 const audio={bpm:90,phase:.25,confidence:.8,receivedAt:1000};
 const active=resolveInputTempo(audio,clock.snapshot(1010),1010);assert.equal(active.source,'midi');assert.ok(Math.abs(active.bpm-120)<.01);
 const fallback=resolveInputTempo(audio,clock.snapshot(2000),2000);assert.equal(fallback.source,'audio');assert.equal(fallback.bpm,90);assert.equal(fallback.phase,.75);
 assert.equal(resolveInputTempo(null,clock.snapshot(2000),2000).source,'none');
 receive(clock,0xf8,2500);assert.equal(clock.snapshot(2500).bpm,0);for(let i=1;i<49;i++)receive(clock,0xf8,2500+i*60000/(140*24));assert.ok(Math.abs(clock.bpm-140)<.01);
});
test('MIDI messages retain channels, raw velocity/CC, normalized intensity and timestamp',()=>{
 assert.deepEqual(parseMidiMessage([0x92,60,100],123),{type:'note-on',channel:3,note:60,velocity:100,intensity:100/127,timestamp:123});
 assert.equal(parseMidiMessage([0x92,60,0],124).type,'note-off');assert.equal(parseMidiMessage([0x82,60,64],125).velocity,64);
 assert.deepEqual(parseMidiMessage([0xb0,74,127],126),{type:'cc',channel:1,controller:74,value:127,intensity:1,timestamp:126});
 assert.deepEqual(parseMidiMessage([0xcf,42],127),{type:'program',channel:16,program:42,timestamp:127});
 for(const data of [[],[0x90,60],[0xb0,128,0],[0xf0,1,2,0xf7],[0xfe]])assert.equal(parseMidiMessage(data,1),null);
 assert.equal(parseMidiMessage([0xf8],NaN),null);
});
