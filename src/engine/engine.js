import { createEffects } from './effects.js';
import { createRenderer } from './renderer.js';
import { createEngineAudio } from './audio.js';
import { createCommandQueue, snapshot } from './protocol.js';
import { LocalLibraryRepository } from '../library/local-repository.js';
import { buildProjectRuntime, normalizeRoutingMap } from '../library/runtime.js';
import { routeSources, routeTargets, eventSourceIds } from '../config.js';
import { NEUTRAL_TARGETS, computeTargetState, resolveTargetActivity } from '../routing.js';
import { applyPanicTargets } from '../show-safety.js';
import { normalizeLook } from '../looks.js';
import { createSequencer } from './sequencer.js';

export function createVisualEngine({canvas,particleCanvas,blackoutOverlay,audioLocked=false,requestMedia=async()=>null,onRendered=()=>{},emit}){
const pcanvas=particleCanvas,ctx=pcanvas.getContext('2d');
let disposed=false,raf=0,mediaGeneration=0;
const neutralVals={energy:0,density:0,drive:0,boombap:0,tension:0,bright:0,open:.60};
let activeProject=null,archetypes=[],IMAGE_SETS=[],looks=[],routingMaps=[],imageConfigs=[],idToIndex=new Map();
let current=0,target=0,archMix=0,transitioning=false,mode='smooth',transitionStart=0;
let projectSwitching=false,deletingArchetype=false,archetypeSelectionBusy=false,queuedArchetype=null;
let blackoutActive=false,panicActive=false,liveLock=false,panicReleaseStartedAt=null;
let controls={enabled:{},solo:{},amounts:{},intensity:{},reactivity:{},targetEnabled:{},targetSolo:{},ctxPerf:0,globalReact:1};
let FinalG={...NEUTRAL_TARGETS},S={...neutralVals},Raw={...neutralVals},Fast={...neutralVals},Context={...neutralVals};
let BPM=0,BPMConfidence=0,beatAnchorSec=null,BeatPulse=0,KickFast=0,SnareFast=0,latestAnalysis=null;
let renderFps=60;
const renderer=createRenderer(canvas,(a,i)=>IMAGE_SETS[a][i],message=>emit({type:'error',source:'renderer',message}));
const trackedMediaLoad=(...args)=>renderer.trackedMediaLoad(...args),swapTextureSlots=role=>renderer.swapTextureSlots(role);
const input=createEngineAudio({locked:audioLocked,onFeatures:applyAnalysisFeatures,onReset:resetInputState,onError:message=>emit({type:'error',message})});
const inputController=input.controller;
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function getEffectiveState(){
  const anySolo = Object.values(controls.solo).some(Boolean);
  const out = {};
  ['energy','density','drive','boombap','tension','bright','open'].forEach(k=>{
    const active = anySolo ? controls.solo[k] : controls.enabled[k];
    const amt = Number(controls.amounts[k]||0);
    const m = active ? amt : 0;
    out[k] = neutralVals[k] + (S[k]-neutralVals[k]) * m;
  });
  return out;
}
function sourceActive(k){
  const anySolo=Object.values(controls.solo).some(Boolean);
  return anySolo ? controls.solo[k] : controls.enabled[k];
}
function computeGlobalMapping(Eff,now){
  const map=routingMaps[target];
  const live=!!inputController?.inputActive;
  const amount=k=>Number(controls.amounts[k]||0);
  const continuous={energy:Eff.energy,density:Eff.density,drive:Eff.drive,boombap:Eff.boombap,tension:Eff.tension,bright:Eff.bright,open:Eff.open};
  const rawSrc={},activeSrc={};
  routeSources.forEach(k=>{
    activeSrc[k]=live&&sourceActive(k);
    if(!activeSrc[k]){rawSrc[k]=0;return}
    let v;if(k==='beat')v=BeatPulse*amount(k);else if(k==='kick')v=KickFast*amount(k);else if(k==='snare')v=SnareFast*amount(k);else v=continuous[k];
    rawSrc[k]=clamp(v,0,1.5);
  });
  const intensity={},reactivity={};
  routeTargets.forEach(k=>{intensity[k]=controls.intensity[k];reactivity[k]=controls.reactivity[k]});
  const activeTargets=resolveTargetActivity({enabled:controls.targetEnabled,solo:controls.targetSolo});
  FinalG=computeTargetState({map,sources:rawSrc,activeSources:activeSrc,activeTargets,intensity,reactivity,globalReactivity:controls.globalReact});
  return FinalG;
}
const sequencer=createSequencer(()=>({imageConfigs,IMAGE_SETS,BPM,BPMConfidence,BeatPulse,KickFast,SnareFast,target,beatAnchorSec,projectSwitching,deletingArchetype,panicActive,archetypeSelectionBusy,mediaGeneration,disposed,archetypes}),renderer);
const {seqStates,createSequenceState,sequenceTempo,imageDwell,loadArchetypeIntoRole,advanceSequenceTransition,requestImageChange,chooseOrderedImage,updateImageSequence}=sequencer;
function sequenceSnapshot(a){const s=seqStates[a];return {current:s.current,next:s.next,blend:s.blend,rawProgress:s.rawProgress,transitioning:s.transitioning,loading:s.loading}}

const pendingVisualEvents=[];let lastFeatureAt=0;
const effects=createEffects(pcanvas,event=>inputController.inputActive&&sourceActive(event.type)?event.intensity*Number(controls.amounts[event.type]||0):0);
function resetVisualEffects(){pendingVisualEvents.length=0;effects.reset()}
function smoothstep(x){return x*x*(3-2*x)}
function setPanic(value){
 const next=!!value;if(next===panicActive)return panicActive;
 panicActive=next;
 if(panicActive){resetVisualEffects();panicReleaseStartedAt=null;current=target;archMix=1;transitioning=false}
 else{panicReleaseStartedAt=performance.now();if(seqStates[target]){seqStates[target].lastSwitch=performance.now();seqStates[target].nextAutoAt=null}}
return panicActive;
}
function setBlackout(value){blackoutActive=!!value;blackoutOverlay.classList.toggle('active',blackoutActive);return blackoutActive}
function resetInputState(resetLayers=false){pendingVisualEvents.length=0;BPM=0;BPMConfidence=0;beatAnchorSec=null;BeatPulse=0;KickFast=0;SnareFast=0;latestAnalysis=null;if(resetLayers){Raw={...neutralVals};Fast={...neutralVals};Context={...neutralVals};S={...neutralVals}}}
function neutralizeInputState(){inputController.resetAnalysis(true);pendingVisualEvents.length=0;BPM=0;BPMConfidence=0;beatAnchorSec=null;BeatPulse=0;KickFast=0;SnareFast=0;latestAnalysis=null;Raw={...neutralVals};Fast={...neutralVals};Context={...neutralVals};S={...neutralVals}}
function applyAnalysisFeatures(features){
 if(disposed)return;latestAnalysis=features;if(!inputController.inputActive)return neutralizeInputState();
 const now=performance.now();lastFeatureAt=now;
 if(!panicActive){for(const event of features.eventBatch||[]){if(eventSourceIds().includes(event.type)&&features.timestamp-event.timestamp<.5)pendingVisualEvents.push({...event,intensity:event.intensity??1,receivedAt:now})}if(pendingVisualEvents.length>64)pendingVisualEvents.splice(0,pendingVisualEvents.length-64)}
 Raw={...features.raw};BPM=features.tempo.bpm;BPMConfidence=features.tempo.confidence;beatAnchorSec=BPM>0?features.timestamp-features.tempo.phase*60/BPM:null;
 BeatPulse=features.events.beat?Math.max(.35,BPMConfidence):features.beat;
 KickFast=features.events.kick?1:features.kick;SnareFast=features.events.snare?1:features.snare;
 Fast={...features.fast};Context={...features.context};
 const mix=controls.ctxPerf,blend=(fast,context,shape)=>{const weight=Math.max(0,Math.min(1,mix*shape));return fast*(1-weight)+context*weight};
 S.energy=blend(Fast.energy,Context.energy,.95);S.density=blend(Fast.density,Context.density,1);S.drive=blend(Fast.drive,Context.drive,.92);S.boombap=Fast.boombap*.8+Context.boombap*.2;S.bright=blend(Fast.bright,Context.bright,1);S.tension=blend(Fast.tension,Context.tension,1.08);S.open=blend(Fast.open,Context.open,1.12);
}
async function selectArchetype(a){
 if(!Number.isInteger(a)||a<0||a>=archetypes.length)return;
 if(projectSwitching||deletingArchetype||disposed)return;
 if(archetypeSelectionBusy){queuedArchetype=a;return}
 if(a===target)return;
 archetypeSelectionBusy=true;mediaGeneration++;renderer.invalidateLoads();
 const previous=target;
 try{
   const prepared=await Promise.all([loadArchetypeIntoRole(0,previous),loadArchetypeIntoRole(1,a)]);
   if(projectSwitching||disposed||(queuedArchetype!=null&&queuedArchetype!==a)){prepared.forEach(p=>p.discard());return}
   prepared.forEach(p=>p.commit());
   current=previous;target=a;
   if(mode==='cut'||panicActive){current=target;archMix=1;transitioning=false}
   else{transitioning=true;archMix=0;transitionStart=performance.now()}
 }finally{
   archetypeSelectionBusy=false;
   const queued=queuedArchetype;queuedArchetype=null;
   if(!disposed&&queued!=null&&queued!==target)launch(selectArchetype(queued));
 }
}
function resize(){renderer.resize();effects.resize(innerWidth,innerHeight)}
let t0=performance.now(),last=performance.now();
function start(){raf=requestAnimationFrame(frame)}
function frame(now){
 if(disposed)return;
 if(renderer.lost){raf=requestAnimationFrame(frame);return}
 resize();
 const dt=Math.max(0,(now-last)/1000);renderFps=renderFps*.95+.05*(1000/Math.max(1,now-last));last=now;
 if(!archetypes.length){renderer.clear();effects.clear();onRendered();publish(now);raf=requestAnimationFrame(frame);return}
 const Eff=getEffectiveState();
 const routedTargets=computeGlobalMapping(Eff,now);
 FinalG=applyPanicTargets(routedTargets,{panic:panicActive,releaseStartedAt:panicReleaseStartedAt,now,duration:300});
 if(panicReleaseStartedAt!=null&&now-panicReleaseStartedAt>=300)panicReleaseStartedAt=null;
 if(transitioning&&current!==target&&seqStates[current]?.transitioning)advanceSequenceTransition(0,current,now);
 if(!projectSwitching&&!archetypeSelectionBusy)updateImageSequence(now,Eff,panicActive);
 if(transitioning){let x=Math.min(1,(now-transitionStart)/6500);archMix=smoothstep(x);if(x>=1){current=target;archMix=1;transitioning=false}}
 const lookA=looks[current],lookB=looks[target],visualTime=(now-t0)/1000;
 effects.update({time:visualTime,dt,lookA,lookB,current:archetypes[current]?.id,target:archetypes[target]?.id,FinalG,panicActive,palette:renderer.palette(1,seqStates[target]?.blend>.5?1:0),BPM,latestAnalysis,lastFeatureAt,events:pendingVisualEvents.splice(0).filter(event=>performance.now()-event.receivedAt<500)});
 const motion=effects.uniforms();
 renderer.draw({lookA,lookB,sequenceA:seqStates[current],sequenceB:seqStates[target],visualTime,motion,motionElapsed:0,breath:motion?.breath||0,FinalG,archMix,transitioning});
 effects.draw(visualTime,dt,lookB,FinalG);onRendered();publish(now,Eff);raf=requestAnimationFrame(frame);
}

let version=0,appliedSeq=0,lastPublish=-Infinity,cache=null;
function publish(now,eff=getEffectiveState(),force=false){
 if(disposed||(!force&&now-lastPublish<50))return;lastPublish=now;
 emit(snapshot(++version,appliedSeq,{
 projectId:activeProject?.id||null,currentId:archetypes[current]?.id||null,targetId:archetypes[target]?.id||null,
 current,target,archMix,transitioning,mode,archetypeSelectionBusy,projectSwitching,
 images:seqStates.map((s,a)=>({id:archetypes[a].id,index:s.transitioning&&s.blend>=.5?s.next:s.current})),
 sequences:seqStates.map((s,a)=>({...sequenceSnapshot(a),loading:s.loading,lastReliableBpm:s.lastReliableBpm})),
 imageTiming:seqStates.map((s,a)=>({tempo:sequenceTempo(a),dwell:imageConfigs[a].images.map((_,i)=>imageDwell(a,i))})),
 finalG:FinalG,eff,raw:Raw,fast:Fast,context:Context,bpm:BPM,bpmConfidence:BPMConfidence,beat:BeatPulse,kick:KickFast,snare:SnareFast,
 analysis:latestAnalysis,transport:input.snapshot(),blackout:blackoutActive,panic:panicActive,liveLock,fps:renderFps,renderer:renderer.diagnostics,outputSettings:renderer.outputSettings
 }));
}
async function loadProject({project,records,cacheName,preferredId,imagePositions=[]}){
 projectSwitching=true;mediaGeneration++;renderer.invalidateLoads();
 try{
 await renderer.waitForLoads();if(disposed)return;
 if(cache?.name!==cacheName){await cache?.close();cache=new LocalLibraryRepository(cacheName)}
 const mediaRecords=new Map();for(const record of records)for(const media of record.media||[])if(!mediaRecords.has(media.mediaId)){
  let saved=await cache.getMedia(media.mediaId);
  if(!saved?.blob){const blob=await requestMedia(media.mediaId,cacheName);if(blob)saved={blob}}
  if(disposed)return;mediaRecords.set(media.mediaId,saved);
 }
 const urls=new Map();for(const [id,saved] of mediaRecords)if(saved?.blob)urls.set(id,URL.createObjectURL(saved.blob));
 const runtime=project?buildProjectRuntime(project,records,media=>urls.has(media.mediaId)?{url:urls.get(media.mediaId),type:media.mime,name:media.name,mediaId:media.mediaId}:null):null;
 for(const role of [0,1])for(const slot of [0,1])renderer.releaseTextureMedia(role,slot);
 for(const url of new Set(IMAGE_SETS.flat().map(s=>s.url).filter(Boolean)))URL.revokeObjectURL(url);
 activeProject=project;archetypes=runtime?.archetypes||[];IMAGE_SETS=runtime?.IMAGE_SETS||[];looks=runtime?.looks||[];routingMaps=runtime?.routingMaps||[];imageConfigs=runtime?.imageConfigs||[];idToIndex=runtime?.idToIndex||new Map();
 seqStates.splice(0,seqStates.length,...archetypes.map(createSequenceState));
 for(const position of imagePositions){const a=idToIndex.get(position.id);if(a!=null&&imageConfigs[a].images[position.index])seqStates[a].current=position.index}
 current=target=idToIndex.get(preferredId)??0;archMix=1;transitioning=false;queuedArchetype=null;archetypeSelectionBusy=false;resetVisualEffects();renderer.clearPalette();
 if(archetypes.length){const prepared=await Promise.all([loadArchetypeIntoRole(0,target),loadArchetypeIntoRole(1,target)]);prepared.forEach(p=>disposed?p.discard():p.commit())}
 }finally{projectSwitching=false}
}
function updateArchetype({id,patch}){
 const a=idToIndex.get(id);if(a==null)return;
 if(patch.look)looks[a]=normalizeLook(patch.look);
 if(patch.routingMap)routingMaps[a]=normalizeRoutingMap(patch.routingMap);
 if(patch.name)archetypes[a].name=patch.name;
 if(patch.imageConfig){
  const old=imageConfigs[a],next=patch.imageConfig,s=seqStates[a];imageConfigs[a]=next;
  if(old.mode!==next.mode||old.timeBase!==next.timeBase){s.lastSwitch=performance.now();s.nextAutoAt=null}
  if(old.mode!==next.mode||old.source!==next.source)s.lastMappedSignal=0;
  if(old.orderMode!==next.orderMode){s.orderState={};s.shownHistory=[s.current];s.shownHistoryCursor=0}
  if(old.images.some((im,i)=>im.duration!==next.images[i]?.duration||im.durationBeats!==next.images[i]?.durationBeats))s.nextAutoAt=null;
 }
}
// Apply the intent in sequence; existing media loaders retain their latest-wins queues.
function launch(operation){Promise.resolve(operation).catch(error=>emit({type:'error',message:error.message})).finally(()=>publish(performance.now(),undefined,true))}
async function apply({type,payload:p}){
 if(disposed)throw new Error('Engine disposed');
 switch(type){
  case 'loadProject':await loadProject(p);break;
  case 'updateArchetype':updateArchetype(p);break;
  case 'selectArchetype':launch(selectArchetype(idToIndex.get(p.id)));break;
  case 'imageStep':{const a=idToIndex.get(p.id);if(a!=null)launch(requestImageChange(a,chooseOrderedImage(a,p.direction),p.trigger||'manual'));break}
  case 'imageGoto':{const a=idToIndex.get(p.id);if(a!=null)launch(requestImageChange(a,p.index,p.trigger||'manual'));break}
  case 'setControls':controls=structuredClone(p.controls);break;
  case 'setTransition':mode=p.mode;break;
  case 'setSafety':if(p.control==='panic')setPanic(p.value);else if(p.control==='blackout')setBlackout(p.value);else liveLock=p.value;break;
  case 'setQuality':renderer.setQuality(p.value);break;
  case 'setRenderScale':renderer.setRenderScale(p.value);resize();break;
  case 'audioRestore':await input.command(type,p);break;
  default:launch(input.command(type,p));
 }
}
const receive=createCommandQueue(apply,seq=>{appliedSeq=seq;publish(performance.now(),undefined,true)});
start();
return {
 receive:message=>disposed?Promise.reject(new Error('Engine disposed')):receive(message).catch(error=>{if(!disposed)emit({type:'error',message:error.message,seq:message.seq});throw error}),
 unlockAudio:()=>input.unlock(),
 async dispose(){if(disposed)return;disposed=true;mediaGeneration++;projectSwitching=true;cancelAnimationFrame(raf);renderer.dispose();effects.reset();blackoutOverlay.classList.remove('active');
  const audioClosed=input.dispose();for(const url of new Set(IMAGE_SETS.flat().map(s=>s.url).filter(Boolean)))URL.revokeObjectURL(url);
  await cache?.close();await audioClosed;
 }
};
}
