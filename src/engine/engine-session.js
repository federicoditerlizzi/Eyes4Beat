// Durable control-side intents plus the latest full status, never render/effect replication.
export class EngineSession{
 constructor(createLocal){this.createLocal=createLocal;this.listeners=new Set();this.saved=new Map();this.pendingSafety=new Map();this.pendingAudio={};this.pendingSelection=null;this.project=null;this.audioFile=null;this.state=null;this.switching=false;this.pending=[];this.generation=0;this.bind(createLocal())}
 bind(transport){this.transport=transport;const generation=++this.generation;this.unsubscribe=transport.subscribe(event=>{
  if(generation!==this.generation)return;
  if(event.type==='state'){
   this.state=structuredClone(event.state);
   if(!this.switching){
   for(const control of ['blackout','panic','liveLock']){
    if(this.pendingSafety.get(control)===this.state[control])this.pendingSafety.delete(control);
    if(!this.pendingSafety.has(control))this.saved.set('safety:'+control,{control,value:!!this.state[control]});
   }
   if(this.pendingSelection===this.state.targetId)this.pendingSelection=null;
   if(!this.state.transport?.locked&&this.state.transport?.loaded&&this.pendingAudio.fileName===this.state.transport.fileName)delete this.pendingAudio.currentTime;
   if(!this.state.transport?.locked)for(const [key,value] of Object.entries(this.pendingAudio)){
    if(key==='currentTime'?Math.abs(this.state.transport?.currentTime-value)<1:this.state.transport?.[key]===value)delete this.pendingAudio[key];
   }
   }
  }
  for(const listener of this.listeners)listener(structuredClone(event));
 });}
 remember(type,p){
  if(type==='loadProject'){this.project=structuredClone(p);this.pendingSelection=null}
  else if(type==='updateArchetype'){const record=this.project?.records.find(r=>r.id===p.id);if(record)Object.assign(record,structuredClone(p.patch))}
  else if(type==='audioLoad'){this.audioFile={blob:p.blob,name:p.name};Object.assign(this.pendingAudio,{mode:'file',paused:false,currentTime:0,fileName:p.name.replace(/\.[^.]+$/,'')})}
  else if(type==='selectArchetype')this.pendingSelection=p.id;
  else if(type==='audioPause'||type==='audioPlay')this.pendingAudio.paused=type==='audioPause';
  else if(type==='audioSeek')this.pendingAudio.currentTime=p.fraction*(this.state?.transport?.duration||0);
  else if(type==='audioVolume'){this.pendingAudio.volume=p.value;if(p.value>0)this.pendingAudio.muted=false}
  else if(type==='audioMute')this.pendingAudio.muted=p.value;
  else if(type==='setTrim')this.pendingAudio.trim=p.value;
  else if(type==='setInput'){this.pendingAudio.mode=p.mode;if(p.device)this.pendingAudio.device=p.device} 
  else if(['setControls','setTransition','setQuality','setRenderScale','setDiagnostics'].includes(type))this.saved.set(type,structuredClone(p));
  else if(type==='setSafety'){this.pendingSafety.set(p.control,p.value);this.saved.set('safety:'+p.control,structuredClone(p))}
 }
 send(type,payload={}){
  if(this.disconnected)return Promise.reject(new Error('Output disconnected — command not sent. Reopen output or choose Use this window.'));
  if(this.switching)return new Promise((resolve,reject)=>this.pending.push({type,payload:structuredClone(payload),resolve,reject}));
  this.remember(type,payload);return this.transport.send(type,payload);
 }
 subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener)}
 async replay(transport,state){
  if(this.project){const p=structuredClone(this.project);p.preferredId=this.pendingSelection||state?.targetId||p.preferredId;p.imagePositions=state?.images||[];await transport.send('loadProject',p)}
  for(const [type,payload] of this.saved)if(!type.startsWith('safety:'))await transport.send(type,payload);
  for(const control of ['blackout','panic','liveLock'])await transport.send('setSafety',{control,value:this.saved.get('safety:'+control)?.value??state?.[control]??false});
  const baseAudio=state?.transport?.locked?this.resumeAudio:state?.transport;const audio=baseAudio?{...baseAudio,...this.pendingAudio}:null;
  if(audio&&(this.audioFile||audio.mode==='live'))await transport.send('audioRestore',{...this.audioFile,mode:audio.mode,device:audio.device,currentTime:audio.currentTime,paused:audio.paused,volume:audio.volume,muted:audio.muted,trim:audio.trim});
  await transport.send('enumerateInputs');
 }
 async switchTo(createTransport,{adopt=false,fallback=true}={}){
  if(this.switching)throw new Error('Engine handover already in progress');
  this.switching=true;const state=structuredClone(this.state);if(!state?.transport?.locked)this.resumeAudio=state?.transport;this.unsubscribe?.();this.generation++;
  try{
   // Teardown completes before the destination engine is constructed.
   await this.transport.dispose();
   const next=await createTransport();this.bind(next);await next.ready;this.disconnected=false;if(adopt===true||(adopt==='available'&&next.recovery)){this.adopt(next.recovery)}else await this.replay(next,state);
  }catch(error){
   await this.transport?.dispose();if(fallback){const local=this.createLocal();this.bind(local);await this.replay(local,state)}else this.disconnected=true;throw error;
  }finally{
   this.switching=false;const pending=this.pending.splice(0);
   for(const item of pending)this.send(item.type,item.payload).then(item.resolve,item.reject);
  }
 }
 adopt(recovery){
  if(!recovery)throw new Error('Output recovery snapshot unavailable');
  this.project=structuredClone(recovery.project);this.audioFile=structuredClone(recovery.audioFile);this.saved=new Map(structuredClone(recovery.saved));
  this.pendingSafety.clear();this.pendingAudio={};this.pendingSelection=null;this.state=structuredClone(recovery.event.state);this.resumeAudio=this.state.transport;
  for(const control of ['blackout','panic','liveLock'])this.saved.set('safety:'+control,{control,value:!!this.state[control]});
  for(const listener of this.listeners)listener(structuredClone(recovery.event));
 }
 markDisconnected(){this.disconnected=true;this.transport.detach?.()}
 useLocal(){this.disconnected=false;return this.switchTo(()=>this.createLocal())}
}
