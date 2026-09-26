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
