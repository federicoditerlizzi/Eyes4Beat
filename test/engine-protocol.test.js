import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {COMMANDS,command,validateCommand,snapshot,createCommandQueue} from '../src/engine/protocol.js';
import {LocalTransport} from '../src/engine/local-transport.js';

test('protocol rejects invalid commands and non-data values before they reach the engine',()=>{
 for(const message of [null,{}, {protocol:1,seq:0,type:'audioPlay',payload:{}},{protocol:2,seq:1,type:'audioPlay',payload:{}},
  {protocol:1,seq:1,type:'unknown',payload:{}},{protocol:1,seq:1,type:'audioVolume',payload:{value:2}}])assert.throws(()=>validateCommand(message));
 for(const payload of [{value:NaN},{value:Infinity},{value:()=>{}},{value:new Date()},{value:new Map()}])assert.throws(()=>command(1,'audioVolume',payload));
 assert.throws(()=>command(1,'toString',{}));
 assert.throws(()=>command(1,'loadProject',{project:{},records:[],cacheName:'test'}));
 assert.throws(()=>command(1,'setControls',{controls:{}}));
 assert.throws(()=>command(1,'updateArchetype',{id:'a',patch:{unknown:true}}));
 assert.throws(()=>command(1,'setInput',{mode:'live',trim:100}));
 assert.equal(command(1,'audioLoad',{blob:new Blob(['audio']),name:'track.wav'}).type,'audioLoad');
});

test('commands arriving out of order wait for missing sequences and async completion',async()=>{
 const calls=[];let release;
 const receive=createCommandQueue(async m=>{calls.push('start'+m.seq);if(m.seq===1)await new Promise(r=>release=r);calls.push('end'+m.seq)});
 const second=receive(command(2,'audioPause'));assert.deepEqual(calls,[]);
 const first=receive(command(1,'audioPlay'));assert.deepEqual(calls,['start1']);
 await assert.rejects(receive(command(1,'audioPlay')),/Duplicate/);
 await assert.rejects(receive(command(2,'audioPause')),/Duplicate/);
 release();await Promise.all([first,second]);assert.deepEqual(calls,['start1','end1','start2','end2']);
 await assert.rejects(receive(command(1,'audioPlay')),/stale/);
});

test('command failure is acknowledged and does not block later commands',async()=>{
 const applied=[];const receive=createCommandQueue(m=>{if(m.seq===1)throw new Error('failure')},n=>applied.push(n));
 await assert.rejects(receive(command(1,'audioPlay')),/failure/);await receive(command(2,'audioPause'));assert.deepEqual(applied,[1,2]);
});

test('local transport clones both directions and ignores stale snapshots',async()=>{
 let emit,received;
 const transport=new LocalTransport(options=>{emit=options.emit;return {receive:async m=>{received=m}}});
 const states=[];transport.subscribe(e=>{states.push(e);e.state.nested.value=99});
 const payload={id:'a',patch:{look:{color:{gain:1}}}};
 await transport.send('updateArchetype',payload);payload.patch.look.color.gain=2;assert.equal(received.payload.patch.look.color.gain,1);
 const original={nested:{value:1}};emit(snapshot(2,1,original));emit(snapshot(1,0,original));emit(snapshot(2,1,original));emit(snapshot(3,1,original));
 assert.deepEqual(states.map(s=>s.version),[2,3]);assert.equal(original.nested.value,1);
 assert.throws(()=>transport.send('audioVolume',{value:2}));await transport.send('audioPause');assert.equal(received.seq,2);
 assert.throws(()=>snapshot(0,0,{}));assert.throws(()=>snapshot(1,-1,{}));
});

test('every runtime UI command is registered; UI has no renderer, audio graph or sequencer access',async()=>{
 const ui=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
 const session=await readFile(new URL('../src/engine/engine-session.js',import.meta.url),'utf8');
 const calls=[...ui.matchAll(/(?:fire|send)\('([^']+)'/g)].map(m=>m[1]);
 for(const type of calls)assert.ok(COMMANDS[type],type);
 for(const type of Object.keys(COMMANDS))assert.ok(calls.includes(type)||['audioPlay','audioPause'].includes(type)||session.includes("send('"+type+"'"),'UI command missing: '+type);
 assert.doesNotMatch(ui,/\.getContext\(|new AudioInputController|\.setTrimDb\(|requestAnimationFrame\(frame\)|\.trackedMediaLoad\(|\.engine\b/);
 assert.doesNotMatch(ui,/seqStates\[[^\]]+\]\.\w+\s*=/);
 for(const file of ['engine','sequencer','effects','renderer']){
  const text=await readFile(new URL('../src/engine/'+file+'.js',import.meta.url),'utf8');
  assert.doesNotMatch(text,/document\.(getElementById|querySelector)|\.textContent\b/,file+' reads UI');
 }
 const queueAt=ui.indexOf("fire('updateArchetype',{id,patch:changes})");const debounceAt=ui.indexOf('pending.timer=setTimeout');assert.ok(queueAt>0&&queueAt<debounceAt,'edits reach engine before save debounce');
});
