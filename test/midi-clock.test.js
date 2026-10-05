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

for(const bpm of [90,120])test(`${bpm} BPM emits one timestamped beat every 24 running clocks`,()=>{
 const clock=new MidiClock(),beats=[],period=60000/(bpm*24);receive(clock,0xfa,0);
 for(let tick=0;tick<73;tick++){const event=receive(clock,0xf8,100+tick*period);if(event)beats.push(event)}
 assert.deepEqual(beats.map(e=>Math.round((e.timestamp*1000-100)/period)),[0,24,48,72]);assert.ok(beats.every(e=>e.type==='beat'&&e.intensity===1&&e.origin==='midi'));
 const last=100+72*period;assert.equal(clock.snapshot(last).beat,1);assert.ok(clock.snapshot(last+50).beat<1);
 receive(clock,0xfc,last+1);for(let i=1;i<=48;i++)assert.equal(receive(clock,0xf8,last+i*period),null);
 assert.equal(clock.snapshot(last+48*period).beat,0);
});
test('stopped clock keeps measuring BPM but audio tempo and beat regain priority',()=>{
 const clock=new MidiClock(),audio={bpm:90,phase:.2,confidence:1,receivedAt:1000};receive(clock,0xfa,0);
 for(let i=0;i<49;i++)receive(clock,0xf8,i*60000/(120*24));receive(clock,0xfc,1001);
 for(let i=49;i<97;i++)receive(clock,0xf8,i*60000/(120*24));
 const snapshot=clock.snapshot(2000);assert.ok(snapshot.present);assert.ok(Math.abs(snapshot.bpm-120)<.01);assert.equal(snapshot.running,false);assert.equal(resolveInputTempo(audio,snapshot,2000).source,'audio');
});
test('SPP parses fourteen bits in six-clock units and aligns the next tick without starting transport',()=>{
 assert.deepEqual(parseMidiMessage([0xf2,1,2],10),{type:'position',position:257,timestamp:10});
 for(const data of [[0xf2,1],[0xf2,128,0],[0xf2,1,128]])assert.equal(parseMidiMessage(data,10),null);
 const clock=new MidiClock();clock.receive(parseMidiMessage([0xf2,5,0],10));assert.equal(clock.tick,30);assert.equal(clock.snapshot(10).phase,.25);assert.equal(clock.running,false);
 receive(clock,0xfb,11);receive(clock,0xf8,20);assert.equal(clock.tick,30);assert.equal(clock.phaseEstimated,false);
 clock.receive(parseMidiMessage([0xf2,8,0],21));const event=receive(clock,0xf8,40);assert.equal(clock.tick,48);assert.equal(event.type,'beat');
});
test('joining steady ticks without transport infers running and phase from first tick or audio',()=>{
 const clock=new MidiClock(),period=60000/(120*24);
 for(let i=0;i<7;i++)receive(clock,0xf8,1000+i*period);
 let snapshot=clock.snapshot(1125);assert.equal(snapshot.running,true);assert.equal(snapshot.phaseEstimated,true);assert.equal(snapshot.phase,.25);assert.equal(resolveInputTempo(null,snapshot,1125).source,'midi');
 const synced=new MidiClock(),audio={bpm:120,phase:.25,receivedAt:1000};
 for(let i=0;i<7;i++)synced.receive(parseMidiMessage([0xf8],1000+i*period),audio);
 assert.equal(synced.snapshot(1125).phase,.5);const beats=[];
 for(let i=7;i<=42;i++){const event=synced.receive(parseMidiMessage([0xf8],1000+i*period),audio);if(event)beats.push(i)}assert.deepEqual(beats,[18,42]);
 receive(synced,0xfa,1900);receive(synced,0xf8,1901);assert.equal(synced.snapshot(1901).phase,0);assert.equal(synced.phaseEstimated,false);
});
test('irregular ticks do not auto-start; explicit Stop prevents inferred restart',()=>{
 const clock=new MidiClock();for(const time of [0,20,40,300,320,340,900])receive(clock,0xf8,time);assert.equal(clock.running,false);
 receive(clock,0xfc,901);for(let i=0;i<80;i++)receive(clock,0xf8,920+i*20);assert.equal(clock.running,false);
});

test('estimated join evaluates audio phase at the MIDI timestamp, including a newer audio snapshot',()=>{
 const clock=new MidiClock(),audio={bpm:120,phase:.4,receivedAt:1200};
 for(let i=0;i<7;i++)clock.receive(parseMidiMessage([0xf8],1000+i*500/24),audio);
 assert.equal(clock.snapshot(1125).phase,.25);
});
