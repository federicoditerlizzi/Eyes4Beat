import { AccentDetector } from '../accents.js';
import { StructureRuntime } from '../structure.js';
import { normalizeRoutingExtras } from '../routing-presets.js';
import {MidiPads,syncMidiSources,midiSourceDefinitions} from '../midi/pads.js';
import { MidiInput } from '../midi/input.js';
import { resolveInputTempo } from '../midi/clock.js';
import { accentParentId, sourceRegistry, getSources, getSource, replaceSources, subscribeSources, isBuiltinAudioSource } from '../source-registry.js';
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
const neutralVals=Object.fromEntries(routeSources.map(id=>[id,0]));
const externalValues={};let replacingSources=false;
let activeProject=null,archetypes=[],IMAGE_SETS=[],looks=[],routingMaps=[],imageConfigs=[],idToIndex=new Map();
let current=0,target=0,archMix=0,transitioning=false,mode='smooth',transitionStart=0;
let projectSwitching=false,deletingArchetype=false,archetypeSelectionBusy=false,queuedArchetype=null;
let blackoutActive=false,panicActive=false,liveLock=false,panicReleaseStartedAt=null;
let controls={enabled:{},solo:{},amounts:{},intensity:{},reactivity:{},targetEnabled:{},targetSolo:{},ctxPerf:0,globalReact:1};
let FinalG={...NEUTRAL_TARGETS},S={...neutralVals},Raw={...neutralVals},Fast={...neutralVals},Context={...neutralVals};
let BPM=0,BPMConfidence=0,beatAnchorSec=null,BeatPulse=0,KickFast=0,SnareFast=0,latestAnalysis=null;
let audioBeat=0,audioTempo=null,tempoState={source:'none',bpm:0,confidence:0,phase:0,running:false,anchorSec:null};
const pads=new MidiPads(),accents=new AccentDetector(),structure=new StructureRuntime();
const eventHits={};let eventSerial=0;
const midi=new MidiInput({getAudioTempo:()=>audioTempo,onEvent:handleMidiMessage});
function enqueueMidiEvent(event,timestamp){
 if(panicActive)return;
 acceptEvent(event,timestamp);
}
function handleMidiMessage(message,beat){
 updateTempo(performance.now());
 if(beat&&tempoState.source==='midi')enqueueMidiEvent(beat,message.timestamp);
 const revision=pads.revision,learning=pads.learning,event=pads.receive(message);
 if(revision!==pads.revision||learning!==pads.learning)publish(performance.now(),undefined,true);
 if(event)enqueueMidiEvent(event,message.timestamp);
}
let renderFps=60;
const renderer=createRenderer(canvas,(a,i)=>IMAGE_SETS[a][i],message=>emit({type:'error',source:'renderer',message}));
const trackedMediaLoad=(...args)=>renderer.trackedMediaLoad(...args),swapTextureSlots=role=>renderer.swapTextureSlots(role);
const input=createEngineAudio({locked:audioLocked,onFeatures:applyAnalysisFeatures,onReset:resetInputState,onError:message=>emit({type:'error',message})});
const inputController=input.controller;
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function getEffectiveState(){
 const out={};for(const source of sourceRegistry){const k=source.id,value=!isBuiltinAudioSource(source.id)?(externalValues[k]||0):k==='beat'?BeatPulse:k==='kick'?KickFast:k==='snare'?SnareFast:S[k]||0;
 if(!inputSourceActive(k)){out[k]=0;continue}
 const amount=Number(controls.amounts[k]??1);out[k]=sourceActive(k)?(amount<0?1-value:value)*Math.abs(amount):0;
 }return out;
}
function inputSourceActive(id){id=accentParentId(id)||id;return !isBuiltinAudioSource(id)||inputController.inputActive||(id==='beat'&&tempoState.source==='midi')}
function sourceActive(k){
  const anySolo=sourceRegistry.some(source=>!!controls.solo[source.id]);
  return anySolo ? !!controls.solo[k] : controls.enabled[k]!==false;
}
function computeGlobalMapping(Eff,now){
  const map=routingMaps[target];
  const rawSrc={},activeSrc={};
  for(const source of sourceRegistry){const k=source.id;activeSrc[k]=inputSourceActive(k)&&sourceActive(k);rawSrc[k]=activeSrc[k]?clamp(Eff[k]||0,0,1.5):0}
  const intensity={},reactivity={};
  routeTargets.forEach(k=>{intensity[k]=controls.intensity[k];reactivity[k]=controls.reactivity[k]});
  const activeTargets=resolveTargetActivity({enabled:controls.targetEnabled,solo:controls.targetSolo});
  FinalG=computeTargetState({map,sources:rawSrc,activeSources:activeSrc,activeTargets,intensity,reactivity,globalReactivity:controls.globalReact});
  return FinalG;
}
const sequencer=createSequencer(()=>({imageConfigs,IMAGE_SETS,BPM,BPMConfidence,BeatPulse,KickFast,SnareFast,target,beatAnchorSec,projectSwitching,deletingArchetype,panicActive,archetypeSelectionBusy,mediaGeneration,disposed,archetypes,sourceValues:getEffectiveState(),sourceEvents:Object.fromEntries(Object.entries({...eventHits,...pads.hits,...(tempoState.source==='midi'&&midi.clock.lastBeat?{beat:midi.clock.lastBeat}:{})}).map(([id,hit])=>[id,{...hit,intensity:sourceActive(id)?hit.intensity*Math.abs(Number(controls.amounts[id]??1)):0}]))}),renderer);
const {seqStates,createSequenceState,sequenceTempo,imageDwell,loadArchetypeIntoRole,advanceSequenceTransition,requestImageChange,chooseOrderedImage,updateImageSequence}=sequencer;
function sequenceSnapshot(a){const s=seqStates[a];return {current:s.current,next:s.next,blend:s.blend,rawProgress:s.rawProgress,transitioning:s.transitioning,loading:s.loading}}

const pendingVisualEvents=[];let lastFeatureAt=0;
function acceptEvent(event,receivedAt){
 if(panicActive||!Number.isFinite(event.intensity)||event.intensity<=0||getSource(event.type)?.kind!=='event'||getSource(event.type)?.group==='accent')return;
 const append=hit=>{pendingVisualEvents.push({...hit,receivedAt});eventHits[hit.type]={...hit,timestamp:receivedAt/1000,serial:++eventSerial}};
 append(event);
 const accent=accents.process(event,controls.accent,BPM);
 if(accent&&getSource(accent.type)){externalValues[accent.type]=accent.intensity;append(accent)}
 if(pendingVisualEvents.length>128)pendingVisualEvents.splice(0,pendingVisualEvents.length-128);
}
function structureRows(a){return a===target?controls.structure:archetypes[a]?.routingControls?.structure}

const effects=createEffects(pcanvas,event=>inputSourceActive(event.type)&&sourceActive(event.type)?event.intensity*Number(controls.amounts[event.type]??1):0);
function resetVisualEffects(){accents.reset();for(const id of Object.keys(eventHits))delete eventHits[id];pads.clear();pendingVisualEvents.length=0;for(const source of sourceRegistry)if(source.kind==='event')externalValues[source.id]=0;effects.reset()}
function smoothstep(x){return x*x*(3-2*x)}
function setPanic(value){
 const next=!!value;if(next===panicActive)return panicActive;
 panicActive=next;
 if(panicActive){structure.reset();renderer.clearFeedback();resetVisualEffects();panicReleaseStartedAt=null;current=target;archMix=1;transitioning=false}
 else{panicReleaseStartedAt=performance.now();if(seqStates[target]){seqStates[target].lastSwitch=performance.now();seqStates[target].nextAutoAt=null}}
return panicActive;
}
function setBlackout(value){blackoutActive=!!value;blackoutOverlay.classList.toggle('active',blackoutActive);return blackoutActive}
function discardAudioEvents(){for(let i=pendingVisualEvents.length-1;i>=0;i--)if(isBuiltinAudioSource(accentParentId(pendingVisualEvents[i].type)||pendingVisualEvents[i].type)&&pendingVisualEvents[i].origin!=='midi')pendingVisualEvents.splice(i,1)}
function resetInputState(resetLayers=false){
 audioTempo=null;audioBeat=0;discardAudioEvents();for(const source of sourceRegistry)if(isBuiltinAudioSource(source.id)&&!(source.id==='beat'&&tempoState.source==='midi'))accents.reset(source.id);for(const id of Object.keys(eventHits))if(isBuiltinAudioSource(accentParentId(id)||id)&&eventHits[id].origin!=='midi'){delete eventHits[id];externalValues[id]=0}KickFast=0;SnareFast=0;latestAnalysis=null;
 if(resetLayers){Raw={...neutralVals};Fast={...neutralVals};Context={...neutralVals};S={...neutralVals}}
 updateTempo(performance.now());
}
function neutralizeInputState(){inputController.resetAnalysis(true);resetInputState(true)}
function applyAnalysisFeatures(features){
 if(disposed)return;latestAnalysis=features;if(!inputController.inputActive)return neutralizeInputState();
 const now=performance.now();lastFeatureAt=now;audioTempo={...features.tempo,receivedAt:now};audioBeat=features.beat;updateTempo(now);
 if(!panicActive){for(const event of features.eventBatch||[]){if(eventSourceIds().includes(event.type)&&features.timestamp-event.timestamp<.5&&!(event.type==='beat'&&tempoState.source==='midi'))acceptEvent({...event,intensity:event.intensity??1},now)}if(pendingVisualEvents.length>64)pendingVisualEvents.splice(0,pendingVisualEvents.length-64)}
 Raw={...features.raw};
 KickFast=features.kick;SnareFast=features.snare;
 Fast={...features.fast};Context={...features.context};
 const mix=controls.ctxPerf,blend=(fast,context,shape)=>{const weight=Math.max(0,Math.min(1,mix*shape));return fast*(1-weight)+context*weight};
 for(const source of sourceRegistry)if(source.kind==='continuous'&&isBuiltinAudioSource(source.id))S[source.id]=blend(Fast[source.id]||0,Context[source.id]||0,1);
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
   const switchedAt=performance.now();structure.release(archetypes[previous]?.id,looks[previous],switchedAt);structure.release(archetypes[a]?.id,looks[a],switchedAt);
   current=previous;target=a;
   controls={...controls,structure:archetypes[a]?.routingControls?.structure||[],accent:archetypes[a]?.routingControls?.accent};
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
function updateTempo(now){
 const clock=midi.clock.snapshot(now),previous=tempoState.source;tempoState=resolveInputTempo(audioTempo,clock,now);
 BPM=tempoState.bpm;BPMConfidence=tempoState.confidence;beatAnchorSec=tempoState.anchorSec;BeatPulse=tempoState.source==='midi'?clock.beat:audioBeat;
 if(previous!==tempoState.source){accents.reset('beat');externalValues.beat_accent=0;delete eventHits.beat_accent}
 if(previous!==tempoState.source)for(let i=pendingVisualEvents.length-1;i>=0;i--){const event=pendingVisualEvents[i];if((event.type==='beat'||event.type==='beat_accent')&&((event.origin==='midi')!==(tempoState.source==='midi')))pendingVisualEvents.splice(i,1)}
}
function frame(now){
 if(disposed)return;
 updateTempo(now);
 Object.assign(externalValues,pads.values(now));
 if(renderer.lost){raf=requestAnimationFrame(frame);return}
 resize();
 const dt=Math.max(0,(now-last)/1000);renderFps=renderFps*.95+.05*(1000/Math.max(1,now-last));last=now;
 for(const source of sourceRegistry)if(!isBuiltinAudioSource(source.id)&&source.group!=='midi-pad'&&source.kind==='event')externalValues[source.id]=(externalValues[source.id]||0)*Math.exp(-dt/0.12);
 if(!archetypes.length){renderer.clear();effects.clear();onRendered();publish(now);raf=requestAnimationFrame(frame);return}
 const Eff=getEffectiveState();
 const routedTargets=computeGlobalMapping(Eff,now);
 FinalG=applyPanicTargets(routedTargets,{panic:panicActive,releaseStartedAt:panicReleaseStartedAt,now,duration:300});
 if(panicReleaseStartedAt!=null&&now-panicReleaseStartedAt>=300)panicReleaseStartedAt=null;
 if(transitioning&&current!==target&&seqStates[current]?.transitioning)advanceSequenceTransition(0,current,now);
 if(!projectSwitching&&!archetypeSelectionBusy)updateImageSequence(now,Eff,panicActive);
 if(transitioning){let x=Math.min(1,(now-transitionStart)/6500);archMix=smoothstep(x);if(x>=1){current=target;archMix=1;transitioning=false}}
 const events=pendingVisualEvents.splice(0).filter(event=>now-event.receivedAt<500);
 if(!panicActive)for(const event of events)if(inputSourceActive(event.type)&&sourceActive(event.type)&&Number(controls.amounts[event.type]??1)!==0)structure.trigger(archetypes[target].id,structureRows(target),looks[target],event,event.receivedAt);
 const lookA=structure.apply(archetypes[current].id,structureRows(current),looks[current],now),lookB=structure.apply(archetypes[target].id,structureRows(target),looks[target],now),visualTime=(now-t0)/1000;
 effects.update({time:visualTime,dt,lookA,lookB,current:archetypes[current]?.id,target:archetypes[target]?.id,FinalG,panicActive,palette:renderer.palette(1,seqStates[target]?.blend>.5?1:0),BPM,tempo:tempoState,latestAnalysis,lastFeatureAt,events});
 const motion=effects.uniforms();
 renderer.draw({dt,panicActive,lookA,lookB,sequenceA:seqStates[current],sequenceB:seqStates[target],visualTime,motion,motionElapsed:0,breath:motion?.breath||0,FinalG,archMix,transitioning});
 effects.draw(visualTime,dt,lookB,FinalG);onRendered();publish(now,Eff);raf=requestAnimationFrame(frame);
}

let version=0,appliedSeq=0,lastPublish=-Infinity,cache=null;
function publish(now,eff=getEffectiveState(),force=false){
 if(disposed||(!force&&now-lastPublish<50))return;lastPublish=now;
 emit(snapshot(++version,appliedSeq,{
 projectId:activeProject?.id||null,currentId:archetypes[current]?.id||null,targetId:archetypes[target]?.id||null,
 current,target,archMix,transitioning,mode,archetypeSelectionBusy,projectSwitching,activeRoutingPresetId:archetypes[target]?.activeRoutingPresetId||null,
 images:seqStates.map((s,a)=>({id:archetypes[a].id,index:s.transitioning&&s.blend>=.5?s.next:s.current})),
 sequences:seqStates.map((s,a)=>({...sequenceSnapshot(a),loading:s.loading,lastReliableBpm:s.lastReliableBpm})),
 imageTiming:seqStates.map((s,a)=>({tempo:sequenceTempo(a),dwell:imageConfigs[a].images.map((_,i)=>imageDwell(a,i))})),
 structure:archetypes[target]?structure.snapshot(archetypes[target].id,structureRows(target),looks[target],now):[],sources:getSources(),finalG:FinalG,eff,raw:Raw,fast:Fast,context:Context,bpm:BPM,bpmConfidence:BPMConfidence,beat:BeatPulse,kick:KickFast,snare:SnareFast,
 tempo:tempoState,midi:midi.snapshot(now),midiPads:pads.snapshot(now),analysis:latestAnalysis,transport:input.snapshot(),blackout:blackoutActive,panic:panicActive,liveLock,fps:renderFps,renderer:renderer.diagnostics,outputSettings:renderer.outputSettings
 }));
}
async function loadProject({project,records,cacheName,preferredId,imagePositions=[]}){
 projectSwitching=true;mediaGeneration++;structure.reset();accents.reset();renderer.clearFeedback();renderer.invalidateLoads();
 pads.load(project?.id||null,project?.midiSlots);syncMidiSources(pads.slots);
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
 current=target=idToIndex.get(preferredId)??0;controls={...controls,structure:archetypes[target]?.routingControls?.structure||[],accent:archetypes[target]?.routingControls?.accent};archMix=1;transitioning=false;queuedArchetype=null;archetypeSelectionBusy=false;resetVisualEffects();renderer.clearPalette();
 if(archetypes.length){const prepared=await Promise.all([loadArchetypeIntoRole(0,target),loadArchetypeIntoRole(1,target)]);prepared.forEach(p=>disposed?p.discard():p.commit())}
 }finally{projectSwitching=false}
}
function updateArchetype({id,patch}){
 const a=idToIndex.get(id);if(a==null)return;
 Object.assign(archetypes[a],structuredClone(patch));
 if(a===target&&patch.routingControls)controls=structuredClone(patch.routingControls);
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
  case 'loadProject':await loadProject(p);if(!audioLocked)launch(midi.initialize());break;
  case 'setMidiSlots':if(p.projectId===activeProject?.id&&JSON.stringify(p.slots)!==JSON.stringify(pads.slots)){pads.set(p.slots);activeProject.midiSlots=pads.slots;syncMidiSources(pads.slots)}break;
  case 'learnMidiSlot':if(p.projectId===activeProject?.id)pads.learn(p.slotId);break;
  case 'confirmMidiBinding':if(p.projectId===activeProject?.id)pads.confirm(p.token,p.accept);break;
  case 'updateArchetype':updateArchetype(p);break;
  case 'selectArchetype':launch(selectArchetype(idToIndex.get(p.id)));break;
  case 'imageStep':{const a=idToIndex.get(p.id);if(a!=null)launch(requestImageChange(a,chooseOrderedImage(a,p.direction),p.trigger||'manual'));break}
  case 'imageGoto':{const a=idToIndex.get(p.id);if(a!=null)launch(requestImageChange(a,p.index,p.trigger||'manual'));break}
  case 'enumerateMidi':launch(midi.enumerate());break;
  case 'setMidiInput':launch(midi.select(p.device));break;
  case 'setSources':replacingSources=true;try{replaceSources([...p.sources.filter(source=>source.group!=='midi-pad'&&source.group!=='accent'),...midiSourceDefinitions(pads.slots)])}finally{replacingSources=false}break;
  case 'setSourceValues':for(const [id,value] of Object.entries(p.values)){const source=getSource(id);if(!source||source.group==='accent'||isBuiltinAudioSource(source.id))continue;externalValues[id]=value;if(source.kind==='event'&&value>0&&!panicActive)acceptEvent({type:id,intensity:value,timestamp:performance.now()/1000},performance.now())}break;
  case 'setControls':controls=normalizeRoutingExtras(structuredClone(p.controls));break;
  case 'setTransition':mode=p.mode;break;
  case 'setSafety':if(p.control==='panic')setPanic(p.value);else if(p.control==='blackout')setBlackout(p.value);else liveLock=p.value;break;
  case 'setFeedback':renderer.setFeedback(p.value);break;
  case 'setQuality':renderer.setQuality(p.value);break;
  case 'setRenderScale':renderer.setRenderScale(p.value);resize();break;
  case 'audioRestore':await input.command(type,p);break;
  default:launch(input.command(type,p));
 }
}
const unsubscribeSources=subscribeSources(sources=>{
 for(const id of Object.keys(externalValues))if(!getSource(id))delete externalValues[id];
 for(const id of Object.keys(eventHits))if(!getSource(id))delete eventHits[id];
 for(const id of accents.history.keys())if(!getSource(id))accents.reset(id);
 if(!projectSwitching)for(let a=0;a<archetypes.length;a++){routingMaps[a]=normalizeRoutingMap(routingMaps[a]);if(!getSource(imageConfigs[a].source))imageConfigs[a].source='none';looks[a]=normalizeLook(looks[a])}
 if(!replacingSources)emit({type:'sources',sources});
});
const receive=createCommandQueue(apply,seq=>{appliedSeq=seq;publish(performance.now(),undefined,true)});
start();
return {
 receive:message=>disposed?Promise.reject(new Error('Engine disposed')):receive(message).catch(error=>{if(!disposed)emit({type:'error',message:error.message,seq:message.seq});throw error}),
 unlockAudio:async()=>{await input.unlock();await midi.initialize()},
 async dispose(){if(disposed)return;disposed=true;unsubscribeSources();mediaGeneration++;projectSwitching=true;cancelAnimationFrame(raf);renderer.dispose();effects.reset();blackoutOverlay.classList.remove('active');
  const audioClosed=input.dispose(),midiClosed=midi.dispose();for(const url of new Set(IMAGE_SETS.flat().map(s=>s.url).filter(Boolean)))URL.revokeObjectURL(url);
  await cache?.close();await audioClosed;await midiClosed;
 }
};
}
