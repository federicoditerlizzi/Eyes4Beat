import test from 'node:test';
import assert from 'node:assert/strict';
import {MidiInput,MIDI_DEVICE_KEY} from '../src/midi/input.js';
function fixture(saved=null,options={}){
 const values=new Map([[MIDI_DEVICE_KEY,JSON.stringify(saved)]]),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const port={id:'mpc',name:'MPC',manufacturer:'Akai',state:'connected',opens:0,closes:0,async open(){this.opens++},async close(){this.closes++}};
 const access={inputs:new Map([[port.id,port]])};let requests=0;
 const midi=new MidiInput({...options,storage,navigator:{requestMIDIAccess:async options=>{assert.equal(options.sysex,false);requests++;return access}}});
 return {midi,port,access,values,requests:()=>requests};
}
test('MIDI is opt-in; selected device persists, monitor uses timestamps and teardown closes the port',async()=>{
 const {midi,port,values,requests}=fixture();await midi.initialize();assert.equal(requests(),0);
 await midi.enumerate();assert.equal(requests(),1);await midi.select('mpc');assert.equal(midi.snapshot(200).connected,true);
 port.onmidimessage({data:[0x90,64,95],timeStamp:100});port.onmidimessage({data:[0xb0,1,70],timeStamp:110});
 assert.equal(midi.snapshot(10000).activity[1].timestamp,100);assert.equal(midi.snapshot(10000).activity[0].value,70);
 assert.equal(JSON.parse(values.get(MIDI_DEVICE_KEY)).id,'mpc');await midi.dispose();assert.equal(port.onmidimessage,null);assert.equal(accessState(midi),null);assert.equal(port.closes,1);
});
function accessState(midi){return midi.access.onstatechange}
test('unplug/replug reopens only the chosen device, including a stable unique name with a changed id',async()=>{
 const {midi,port,access}=fixture({id:'mpc',name:'MPC',manufacturer:'Akai'});await midi.initialize();
 port.state='disconnected';await midi.reconcile();assert.equal(midi.snapshot(0).connected,false);assert.equal(midi.snapshot(0).selected,'mpc');
 access.inputs.delete('mpc');port.id='mpc-new';port.state='connected';access.inputs.set(port.id,port);await midi.reconcile();assert.equal(midi.snapshot(0).connected,true);assert.equal(midi.snapshot(0).selected,'mpc-new');
 await midi.select('');assert.equal(midi.snapshot(0).selected,'');assert.equal(port.onmidimessage,null);await midi.dispose();
});
test('unsupported and denied access stay visible, with retry and no device handles in snapshots',async()=>{
 const unsupported=new MidiInput({navigator:{},storage:{getItem:()=>null}});await unsupported.enumerate();assert.equal(unsupported.snapshot(0).supported,false);
 let denied=true;const midi=new MidiInput({storage:{getItem:()=>null},navigator:{requestMIDIAccess:async()=>{if(denied)throw Object.assign(new Error('Denied'),{name:'NotAllowedError'});return {inputs:new Map()}}}});
 await midi.enumerate();assert.match(midi.snapshot(0).error,/permission denied/);denied=false;await midi.enumerate();assert.equal(midi.snapshot(0).access,true);assert.doesNotThrow(()=>structuredClone(midi.snapshot(0)));await midi.dispose();
});

test('port connection events do not reopen an input after OFF',async()=>{
 const {midi,port,access}=fixture();
 port.open=async()=>{port.opens++;queueMicrotask(()=>access.onstatechange?.({port}))};port.close=async()=>{port.closes++;queueMicrotask(()=>access.onstatechange?.({port}))};
 await midi.enumerate();await midi.select('mpc');assert.equal(midi.snapshot(0).connected,true);
 await midi.select('');await new Promise(r=>setImmediate(r));assert.equal(midi.snapshot(0).selected,'');assert.equal(midi.snapshot(0).connected,false);assert.equal(port.opens,1);await midi.dispose();
});
test('turning OFF or disposing during a pending open never attaches a stale handler',async()=>{
 for(const action of ['off','dispose']){
  const {midi,port}=fixture();await midi.enumerate();let release;port.open=()=>new Promise(resolve=>release=resolve);
  const selection=midi.select('mpc');await new Promise(r=>setImmediate(r));
  if(action==='off')await midi.select('');else await midi.dispose();release();await selection;
  assert.equal(midi.snapshot(0).connected,false);assert.ok(!port.onmidimessage);assert.ok(port.closes>0);await midi.dispose();
 }
});

test('MIDI input forwards timestamped beat events and uses the supplied audio phase on join',async()=>{
 const beats=[],{midi,port}=fixture(null,{getAudioTempo:()=>({bpm:120,phase:.25,receivedAt:1000}),onEvent:(message,beat)=>{if(beat)beats.push(beat)}});
 await midi.select('mpc');for(let i=0;i<=42;i++)port.onmidimessage({data:[248],timeStamp:1000+i*500/24});
 assert.equal(midi.snapshot(1875).clock.phaseEstimated,true);assert.deepEqual(beats.map(b=>Math.round((b.timestamp*1000-1000)*24/500)),[18,42]);
 port.onmidimessage({data:[252],timeStamp:1876});for(let i=43;i<=90;i++)port.onmidimessage({data:[248],timeStamp:1000+i*500/24});assert.equal(beats.length,2);await midi.dispose();
});
