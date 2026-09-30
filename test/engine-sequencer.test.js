import test from 'node:test';
import assert from 'node:assert/strict';
import {createSequencer} from '../src/engine/sequencer.js';
import {defaultImageConfig} from '../src/library/runtime.js';

function fixture(){
 const config=defaultImageConfig(4);config.mode='manual';config.triggers.manual.pool=['cut'];
 const runtime={imageConfigs:[config],IMAGE_SETS:[[{}, {}, {}, {}]],BPM:0,BPMConfidence:0,BeatPulse:0,KickFast:0,SnareFast:0,target:0,beatAnchorSec:null,projectSwitching:false,deletingArchetype:false,panicActive:false,mediaGeneration:0,archetypeSelectionBusy:false,archetypes:[{id:'a'}]};
 const loads=[];
 const renderer={trackedMediaLoad:(...args)=>new Promise(resolve=>loads.push({args,resolve})),swapTextureSlots:()=>{}};
 const seq=createSequencer(()=>runtime,renderer);seq.seqStates.push(seq.createSequenceState());
 return {runtime,seq,loads};
}

test('extracted sequencer retains latest pending media request while a load is in progress',async()=>{
 const {seq,loads}=fixture();
 const first=seq.requestImageChange(0,1,'manual');
 await seq.requestImageChange(0,2,'manual');await seq.requestImageChange(0,3,'manual');
 assert.equal(loads.length,1);assert.equal(seq.seqStates[0].pendingRequest.idx,3);
 loads[0].resolve();await first;assert.equal(loads.length,2);assert.deepEqual(loads[1].args,[1,1,0,3]);
 loads[1].resolve();await new Promise(r=>setImmediate(r));assert.equal(seq.seqStates[0].current,3);
});

test('panic and project switch are read again after asynchronous texture load',async()=>{
 for(const key of ['panicActive','projectSwitching']){
  const {seq,runtime,loads}=fixture();const loading=seq.requestImageChange(0,1,'manual');runtime[key]=true;
  loads[0].resolve();await loading;assert.equal(seq.seqStates[0].transitioning,false);assert.equal(seq.seqStates[0].current,0);assert.equal(seq.seqStates[0].loading,false);
 }
});

test('cut and beat-time settings retain their original sequencing calculations',()=>{
 const {seq,runtime}=fixture();runtime.imageConfigs[0].timeBase='beats';runtime.imageConfigs[0].images[0].durationBeats=1;
 const dwell=seq.imageDwell(0,0);assert.equal(dwell.seconds,2);assert.equal(dwell.effectiveBeats,4);
 const transition=seq.createSequenceTransition(0,0,1,'manual');assert.equal(transition.transitionId,'cut');assert.equal(transition.duration,0);
});

test('mapped event hold uses beats at 120 BPM; events inside hold are ignored, not queued',async()=>{
 const {seq,runtime,loads}=fixture(),cfg=runtime.imageConfigs[0],state=seq.seqStates[0];
 cfg.mode='mapped';cfg.source='kick';cfg.timeBase='beats';cfg.images[0].durationBeats=4;cfg.images[0].duration=50;cfg.triggers.event.pool=['cut'];runtime.BPM=120;runtime.BPMConfidence=1;state.lastSwitch=0;
 const kick=(time,value)=>{runtime.KickFast=value;seq.updateImageSequence(time,{})};
 assert.equal(seq.imageDwell(0,0).seconds,2);
 kick(1000,1);kick(1100,0);kick(1900,1);kick(2000,1);
 assert.equal(loads.length,0,'an event starting during hold must not fire when hold expires');
 kick(2100,0);assert.equal(loads.length,0,'ignored events are not queued');kick(2200,1);
 assert.equal(loads.length,1);assert.deepEqual(loads[0].args,[1,1,0,1]);loads[0].resolve();await new Promise(r=>setImmediate(r));assert.equal(state.current,1);
});

test('mapped seconds hold has the same minimum and no hidden eight-second cap',()=>{
 const {seq,runtime,loads}=fixture(),cfg=runtime.imageConfigs[0];cfg.mode='mapped';cfg.source='kick';cfg.images[0].duration=20;seq.seqStates[0].lastSwitch=0;
 runtime.KickFast=1;seq.updateImageSequence(9000,{});assert.equal(loads.length,0);
 runtime.KickFast=0;seq.updateImageSequence(19999,{});runtime.KickFast=1;seq.updateImageSequence(20000,{});assert.equal(loads.length,1);
 cfg.images[0].duration=1;assert.equal(seq.imageDwell(0,0).seconds,2);
 cfg.images[0].duration=20;cfg.triggers.event.duration=8;cfg.triggers.event.pool=['crossfade'];assert.equal(seq.createSequenceTransition(0,0,1,'event').duration,8,'transition limit uses the same dwell');
});

test('continuous mapping keeps its image positions and uses beat hold with tempo fallback',()=>{
 const {seq,runtime,loads}=fixture(),cfg=runtime.imageConfigs[0];cfg.mode='mapped';cfg.source='energy';cfg.timeBase='beats';cfg.images[0].durationBeats=4;seq.seqStates[0].lastSwitch=0;
 assert.equal(seq.imageDwell(0,0).seconds,2,'unknown tempo falls back to 120 BPM');
 seq.updateImageSequence(1999,{energy:.7});assert.equal(loads.length,0);
 seq.updateImageSequence(2000,{energy:.7});assert.deepEqual(loads[0].args,[1,1,0,2]);
 runtime.BPM=60;runtime.BPMConfidence=1;assert.equal(seq.imageDwell(0,0).seconds,4);
 runtime.BPM=0;runtime.BPMConfidence=0;assert.equal(seq.imageDwell(0,0).seconds,4,'last reliable tempo is retained');
});
