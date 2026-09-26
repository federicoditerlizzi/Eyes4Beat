import {command,PROTOCOL_VERSION,validateCommand} from './protocol.js';

export function isOutputHello(event,output,origin,session){
 return event.source===output&&event.origin===origin&&event.data?.type==='output-hello'&&event.data.protocol===PROTOCOL_VERSION&&event.data.session===session;
}
// A delayed control timer gets a fresh grace period: a busy/hidden controller is
// not evidence that the independently running output has failed.
export class HeartbeatWatch {
 constructor(now=()=>performance.now(),timeout=2000){this.now=now;this.timeout=timeout;this.last=this.checked=now()}
 receive(){this.last=this.now()}
 expired(){const now=this.now();if(now-this.checked>this.timeout)this.last=now;this.checked=now;return now-this.last>=this.timeout}
}
export class RemoteTransport{
 constructor(port,{onMediaRequest=async()=>null,onDisconnect=()=>{},onMetrics=()=>{},now=()=>performance.now(),heartbeatMs=500,timeout=2000}={}){
  this.port=port;this.sequence=0;this.version=0;this.listeners=new Set();this.pending=new Map();this.closed=false;this.now=now;this.watch=new HeartbeatWatch(now,timeout);this.metrics={heartbeatAge:0,rtt:null};
  this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject});this.ready.catch(()=>{});
  this.onDisconnect=onDisconnect;
  this.timer=setInterval(()=>{if(!this.handshakeReady)return;if(this.watch.expired()){this.disconnect();return}this.metrics.heartbeatAge=now()-this.watch.last;onMetrics({...this.metrics});port.postMessage({type:'ping',at:now()})},heartbeatMs);this.timer.unref?.();
  port.onmessage=async({data})=>{
   if(this.closed)return;this.watch.receive();
   if(data?.type==='ready'&&data.protocol===PROTOCOL_VERSION){this.handshakeReady=true;this.watch.checked=now();this.recovery=data.recovery;this.resolveReady(data.recovery);return}
   if(data?.type==='pong')return;
   if(data?.type==='ack'){
    const item=this.pending.get(data.seq);if(!item)return;this.pending.delete(data.seq);this.metrics.rtt=now()-item.at;onMetrics({...this.metrics});
    data.error?item.reject(new Error(data.error)):item.resolve();return;
   }
   if(data?.type==='media-request'){
    let blob=null;try{blob=await onMediaRequest(data.id,data.cacheName)}catch{}
    if(!this.closed)port.postMessage({type:'media-response',requestId:data.requestId,blob});return;
   }
   if(data?.type==='disposed'){this.finishDispose?.();return}
   if(data?.type==='closed'){this.disconnect();return}
   if(data?.type==='event'){
    const event=data.event;if(event?.type==='state'){port.postMessage({type:'snapshot-ack'});if(event.version<=this.version)return;this.version=event.version;this.latestEvent=event}
    for(const listener of this.listeners)listener(structuredClone(event));
   }
  };
  port.onmessageerror=()=>this.disconnect();port.start?.();
 }
 async send(type,payload={}){
  const message=command(this.sequence+1,type,payload);this.sequence++;
  await this.ready;if(this.closed||this.disposal)throw new Error('Output disconnected — command not sent');
  return new Promise((resolve,reject)=>{this.pending.set(message.seq,{resolve,reject,at:this.now()});this.port.postMessage({type:'command',message})});
 }
 subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener)}
 disconnect(){if(this.closed)return;this.detach();this.onDisconnect()}
 detach(){
  if(this.closed)return;this.closed=true;clearInterval(this.timer);this.rejectReady(new Error('Output disconnected'));
  for(const item of this.pending.values())item.reject(new Error('Output disconnected — command acknowledgement missing; verify output state before retrying'));
  this.pending.clear();this.listeners.clear();this.port.postMessage({type:'detach'});this.port.close();
 }
 // Explicit shutdown is only for a user-selected local takeover, never unload.
 dispose(){
  if(this.closed)return Promise.resolve();if(this.disposal)return this.disposal;
  this.disposal=new Promise(resolve=>{const timer=setTimeout(()=>this.finishDispose(),500);this.finishDispose=()=>{clearTimeout(timer);this.detach();resolve()};this.port.postMessage({type:'dispose'})});return this.disposal;
 }
}

// The host outlives every port. Its journal is connection-time recovery data,
// not frame replication; the engine remains authoritative and keeps running.
export function hostEnginePort(initialPort,createEngine,options={}){
 let closed=false,port=null,requestId=0,sequence=0,lastRemoteSeq=0,inFlight=false,latest=null;
 const requests=new Map(),saved=new Map();let project=null,audioFile=null;
 const post=data=>{if(!closed&&port)port.postMessage(data)};
 function emit(event){if(event.type==='state'){latest=structuredClone(event);if(inFlight)return;inFlight=true}post({type:'event',event})}
 const engine=createEngine({...options,emit,requestMedia:(id,cacheName)=>new Promise(resolve=>{
  if(!port){resolve(null);return}const key=++requestId,timer=setTimeout(()=>{requests.delete(key);resolve(null)},10000);
  requests.set(key,{resolve,timer});post({type:'media-request',requestId:key,id,cacheName});
 })});
 function remember(type,p){
  if(type==='loadProject')project=structuredClone(p);
  else if(type==='updateArchetype'){const r=project?.records.find(r=>r.id===p.id);if(r)Object.assign(r,structuredClone(p.patch))}
  else if(type==='audioLoad'||type==='audioRestore'){if(p.blob)audioFile={blob:p.blob,name:p.name}}
  else if(['setControls','setTransition','setQuality','setRenderScale','setDiagnostics'].includes(type))saved.set(type,structuredClone(p));
 }
 async function send(type,payload){const message=command(++sequence,type,payload);await engine.receive(message);remember(type,payload)}
 function detach(){port?.close();port=null;inFlight=false;for(const item of requests.values()){clearTimeout(item.timer);item.resolve(null)}requests.clear()}
 function attach(next){
  detach();port=next;lastRemoteSeq=0;const connected=next;
  next.onmessage=({data})=>{
   if(closed||port!==connected)return;
   if(data?.type==='ping'){post({type:'pong',at:data.at});return}
   if(data?.type==='snapshot-ack'){inFlight=false;return}
   if(data?.type==='detach'){detach();return}
   if(data?.type==='media-response'){const item=requests.get(data.requestId);if(item){requests.delete(data.requestId);clearTimeout(item.timer);item.resolve(data.blob instanceof Blob?data.blob:null)}return}
   if(data?.type==='dispose'){void shutdown(false);return}
   if(data?.type!=='command')return;
   let message;try{message=validateCommand(data.message);if(message.seq!==lastRemoteSeq+1)throw new Error('Output command sequence mismatch');lastRemoteSeq=message.seq}
   catch(error){post({type:'ack',seq:data.message?.seq,error:error.message});return}
   send(message.type,message.payload).then(()=>{if(port===connected)post({type:'ack',seq:message.seq})},error=>{if(port===connected)post({type:'ack',seq:message.seq,error:error.message})});
  };
  next.start?.();post({type:'ready',protocol:PROTOCOL_VERSION,recovery:latest&&project?{project,audioFile,saved:[...saved],event:latest}:null});
  if(latest){inFlight=true;post({type:'event',event:latest})}
 }
 async function shutdown(notify=true){if(closed)return;if(notify)post({type:'closed'});await engine.dispose();if(!notify)post({type:'disposed'});detach();closed=true}
 attach(initialPort);
 return {attach,send,unlock:()=>engine.unlockAudio(),dispose:()=>shutdown(),get connected(){return !!port}};
}
