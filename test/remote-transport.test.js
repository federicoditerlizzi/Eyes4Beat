import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteTransport,hostEnginePort,isOutputHello,HeartbeatWatch} from '../src/engine/remote-transport.js';
import {EngineSession} from '../src/engine/engine-session.js';
import {snapshot} from '../src/engine/protocol.js';
const tick=()=>new Promise(r=>setImmediate(r));
function ports(){
 const a={closed:false,start(){},close(){this.closed=true}},b={closed:false,start(){},close(){this.closed=true}};
 a.postMessage=data=>queueMicrotask(()=>{if(!b.closed)b.onmessage?.({data:structuredClone(data)})});
 b.postMessage=data=>queueMicrotask(()=>{if(!a.closed)a.onmessage?.({data:structuredClone(data)})});return [a,b];
}
test('handshake rejects another window, origin, session and protocol',()=>{
 const output={},event={source:output,origin:'https://example.test',data:{type:'output-hello',protocol:1,session:'session'}};
 assert.equal(isOutputHello(event,output,event.origin,'session'),true);
 for(const wrong of [{source:{}},{origin:'https://evil.test'},{data:{...event.data,session:'other'}},{data:{...event.data,protocol:2}}])assert.equal(isOutputHello({...event,...wrong},output,event.origin,'session'),false);
});
test('remote waits for ready, delivers ordered commands, interleaves output-local safety and disposes engine',async()=>{
 const [client,server]=ports(),received=[];let emit,disposed=false;
 const remote=new RemoteTransport(client);const first=remote.send('audioPause'),second=remote.send('audioPlay');await tick();assert.equal(received.length,0);
 const host=hostEnginePort(server,options=>{emit=options.emit;return {receive:async m=>received.push(m),dispose:async()=>{disposed=true}}});
 await Promise.all([first,second]);await host.send('setSafety',{control:'panic',value:true});await remote.send('audioVolume',{value:.5});
 assert.deepEqual(received.map(m=>m.seq),[1,2,3,4]);assert.deepEqual(received.map(m=>m.type),['audioPause','audioPlay','setSafety','audioVolume']);
 const events=[];remote.subscribe(e=>events.push(e));emit(snapshot(2,4,{value:1}));emit(snapshot(1,3,{value:0}));await tick();assert.deepEqual(events.map(e=>e.version),[2]);
 await remote.dispose();assert.equal(disposed,true);
});
test('missing cache media travels as a Blob over the port without blocking command acknowledgements',async()=>{
 const [client,server]=ports();let requestMedia;
 const remote=new RemoteTransport(client,{onMediaRequest:async(id,cache)=>{assert.equal(id,'hash');assert.equal(cache,'cache');return new Blob(['pixels'])}});
 hostEnginePort(server,options=>{requestMedia=options.requestMedia;return {receive:async()=>{},dispose:async()=>{}}});await remote.ready;
 assert.equal(await (await requestMedia('hash','cache')).text(),'pixels');await remote.send('audioPause');await remote.dispose();
});
function fakeTransport(name,log){
 const listeners=new Set();return {ready:Promise.resolve(),send:async(type,payload)=>{log.push({name,type,payload:structuredClone(payload)})},subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},emit:state=>listeners.forEach(fn=>fn({type:'state',version:1,state})),dispose:async()=>{log.push({name,type:'dispose'})}};
}
test('handover tears down before starting destination and replays project edits, selection, image, controls, audio and safety on fallback',async()=>{
 const log=[];let local;const session=new EngineSession(()=>local=fakeTransport('local',log));
 await session.send('loadProject',{project:{id:'p',archetypeOrder:['a']},records:[{id:'a',projectId:'p',media:[],look:{gain:1}}],cacheName:'cache'});
 await session.send('updateArchetype',{id:'a',patch:{look:{gain:2}}});await session.send('setControls',{controls:{amount:1}});
 await session.send('audioLoad',{blob:new Blob(['audio']),name:'song.wav'});
 local.emit({targetId:'a',images:[{id:'a',index:2}],blackout:true,panic:false,liveLock:true,transport:{mode:'file',fileName:'song',loaded:true,device:'file',currentTime:12,paused:false,volume:.6,muted:false,trim:-3}});
 let remote;await session.switchTo(()=>{assert.equal(log.at(-1).type,'dispose');return remote=fakeTransport('remote',log)});
 const replay=log.filter(e=>e.name==='remote');assert.equal(replay[0].type,'loadProject');assert.equal(replay[0].payload.records[0].look.gain,2);assert.equal(replay[0].payload.preferredId,'a');assert.equal(replay[0].payload.imagePositions[0].index,2);
 assert.equal(replay.find(e=>e.type==='audioRestore').payload.currentTime,12);
 remote.emit({...session.state,targetId:'a',transport:{mode:'file',device:'file',currentTime:15,paused:false,volume:.4,muted:true,trim:0}});
 await session.useLocal();assert.equal(log.filter(e=>e.name==='local'&&e.type==='audioRestore').at(-1).payload.currentTime,15);
});
test('commands entered during handover are delivered once, after restored state',async()=>{
 const log=[];const session=new EngineSession(()=>fakeTransport('local',log));let release;
 const switching=session.switchTo(()=>new Promise(resolve=>release=()=>resolve(fakeTransport('remote',log))));await tick();
 const queued=session.send('imageStep',{id:'a',direction:1});release();await switching;await queued;
 const remote=log.filter(e=>e.name==='remote');assert.equal(remote.at(-1).type,'imageStep');assert.equal(remote.filter(e=>e.type==='imageStep').length,1);
});
test('fallback preserves unacknowledged safety, selection and pause intents across stale snapshots',async()=>{
 const log=[];let local;const session=new EngineSession(()=>local=fakeTransport('local',log));
 await session.send('loadProject',{project:{id:'p'},records:[{id:'a'},{id:'b'}],cacheName:'cache'});
 await session.send('audioLoad',{blob:new Blob(['audio']),name:'song.wav'});
 local.emit({targetId:'a',blackout:false,panic:false,liveLock:false,transport:{mode:'file',fileName:'song',paused:false,currentTime:5,volume:1,muted:false,trim:0}});
 await session.send('setSafety',{control:'panic',value:true});await session.send('selectArchetype',{id:'b'});await session.send('audioPause');
 local.emit({...session.state});await session.switchTo(()=>fakeTransport('remote',log));
 const replay=log.filter(e=>e.name==='remote');assert.equal(replay[0].payload.preferredId,'b');assert.equal(replay.find(e=>e.type==='setSafety'&&e.payload.control==='panic').payload.value,true);assert.equal(replay.find(e=>e.type==='audioRestore').payload.paused,true);
});
test('replay does not replace saved safety with the destination default snapshot',async()=>{
 const log=[];let local;const session=new EngineSession(()=>local=fakeTransport('local',log));
 await session.send('loadProject',{project:{id:'p'},records:[],cacheName:'cache'});
 local.emit({blackout:true,panic:true,liveLock:true,transport:{mode:'file',paused:true}});
 await session.switchTo(()=>{const remote=fakeTransport('remote',log),send=remote.send;remote.send=async(type,p)=>{await send(type,p);if(type==='loadProject')remote.emit({blackout:false,panic:false,liveLock:false,transport:{mode:'file',locked:true}})};return remote});
 assert.ok(log.filter(e=>e.name==='remote'&&e.type==='setSafety').every(e=>e.payload.value));
});
test('failed output connection reconstructs a local engine and remains usable',async()=>{
 const log=[];let created=0;const session=new EngineSession(()=>{created++;return fakeTransport('local',log)});
 await session.send('setQuality',{value:'low'});
 await assert.rejects(session.switchTo(()=>{throw new Error('connection failed')}),/connection failed/);
 assert.equal(created,2);await session.send('audioPause');assert.equal(log.at(-1).type,'audioPause');assert.equal(log.filter(e=>e.type==='setQuality').length,2);
});

test('control reload reattaches to the same host and adopts authoritative edits without replay',async()=>{
 const [client,server]=ports(),received=[];let emit,disposed=0;
 const first=new RemoteTransport(client),host=hostEnginePort(server,options=>{emit=options.emit;return {receive:async m=>received.push(m),dispose:async()=>{disposed++}}});
 await first.send('loadProject',{project:{id:'p',archetypeOrder:['a']},records:[{id:'a',projectId:'p',media:[],look:{gain:1}}],cacheName:'cache'});
 await first.send('updateArchetype',{id:'a',patch:{look:{gain:1.7}}});await first.send('setControls',{controls:{ctxPerf:.8,globalReact:1,enabled:{},solo:{},targetEnabled:{},targetSolo:{},amounts:{},intensity:{},reactivity:{}}});
 emit(snapshot(4,3,{targetId:'a',currentId:'a',transport:{currentTime:42,paused:false},panic:true}));await tick();first.detach();await tick();
 assert.equal(disposed,0);emit(snapshot(5,3,{targetId:'a',currentId:'a',transport:{currentTime:44,paused:false},panic:true}));
 const [nextClient,nextServer]=ports(),remote=new RemoteTransport(nextClient);host.attach(nextServer);await remote.ready;
 const log=[],session=new EngineSession(()=>fakeTransport('reload-local',log));let adopted;session.subscribe(e=>adopted=e.state);
 const before=received.length;await session.switchTo(()=>remote,{adopt:true,fallback:false});
 assert.equal(received.length,before,'adoption must not reload or seek the output');assert.equal(session.project.records[0].look.gain,1.7);assert.equal(session.saved.get('setControls').controls.ctxPerf,.8);assert.equal(adopted.transport.currentTime,44);assert.equal(adopted.panic,true);
 await session.send('audioPause');assert.equal(received.at(-1).seq,4);await remote.dispose();assert.equal(disposed,1);
});
test('heartbeat timeout rejects disconnected commands and leaves output alive',async()=>{
 const [client,server]=ports();let now=0,disconnected=0,disposed=0;
 const remote=new RemoteTransport(client,{now:()=>now,heartbeatMs:5,onDisconnect:()=>disconnected++});
 const host=hostEnginePort(server,()=>({receive:async()=>{},dispose:async()=>disposed++}));await remote.ready;
 // Simulate a non-responsive port; advance in regular checks, not a blocked UI timer.
 server.onmessage=null;
 for(let i=0;i<5;i++){now+=500;await new Promise(r=>setTimeout(r,8))}
 assert.equal(disconnected,1);await assert.rejects(remote.send('audioPlay'),/disconnected/);assert.equal(disposed,0);await host.dispose();
});
test('disconnected session rejects visibly actionable commands without remembering rejected edits',async()=>{
 const log=[],session=new EngineSession(()=>fakeTransport('local',log));session.markDisconnected();
 await assert.rejects(session.send('setQuality',{value:'off'}),/command not sent.*Reopen/);assert.equal(session.saved.has('setQuality'),false);assert.equal(log.length,0);
 await session.useLocal();await session.send('setQuality',{value:'low'});assert.equal(session.saved.get('setQuality').value,'low');
});
test('state backpressure bounds messages while control is busy and keeps latest recovery',async()=>{
 const [client,server]=ports();let emit;const host=hostEnginePort(server,options=>{emit=options.emit;return {receive:async()=>{},dispose:async()=>{}}});
 const messages=[];client.onmessage=({data})=>messages.push(data);
 for(let i=1;i<=1000;i++)emit(snapshot(i,0,{n:i}));await tick();assert.equal(messages.filter(m=>m.type==='event').length,1);
 client.postMessage({type:'snapshot-ack'});await tick();emit(snapshot(1001,0,{n:1001}));await tick();assert.equal(messages.filter(m=>m.type==='event').length,2);await host.dispose();
});

test('slow initial handshake does not trip the active-connection heartbeat',async()=>{
 const [client,server]=ports();let now=0,disconnected=false;
 const remote=new RemoteTransport(client,{now:()=>now,heartbeatMs:5,onDisconnect:()=>disconnected=true});
 for(let i=0;i<6;i++){now+=500;await new Promise(r=>setTimeout(r,6))}
 assert.equal(disconnected,false);
 const host=hostEnginePort(server,()=>({receive:async()=>{},dispose:async()=>{}}));await remote.ready;await remote.send('audioPause');await remote.dispose();
});

test('busy controller timer gets one grace period, then detects a genuinely missing heartbeat',()=>{
 let now=0;const watch=new HeartbeatWatch(()=>now);now=10000;assert.equal(watch.expired(),false);
 now=11000;assert.equal(watch.expired(),false);now=12000;assert.equal(watch.expired(),true);
 watch.receive();assert.equal(watch.expired(),false);
});
test('unacknowledged commands reject with an explicit uncertain-delivery error on detach',async()=>{
 const [client,server]=ports(),remote=new RemoteTransport(client);
 server.postMessage({type:'ready',protocol:1});await remote.ready;
 const sent=remote.send('audioPause');await tick();const rejected=assert.rejects(sent,/acknowledgement missing/);remote.disconnect();await rejected;
});
