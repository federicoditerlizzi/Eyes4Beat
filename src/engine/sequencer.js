import { transitionShaderId, resolveTransitionParam } from '../transitions.js';
import { applyTransitionEasing, beatsToSeconds, classifyImageTrigger, effectiveBeatDwell, effectiveTransitionDuration, nextSequenceIndex, pickTransitionFromPool, quantizeToBeatGrid, resolvePendingImageRequest, resolveSequencerTempo, transitionRunsAsCut } from '../image-sequencer.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function createSequencer(getRuntime,renderer){
 const seqStates=[];
 const trackedMediaLoad=(...args)=>renderer.trackedMediaLoad(...args),swapTextureSlots=role=>renderer.swapTextureSlots(role);
function createSequenceState(){
return {current:0,next:1,blend:0,rawProgress:0,transitioning:false,loading:false,loadingTarget:null,pendingRequest:null,poolStates:{timed:{},event:{},manual:{}},orderState:{},shownHistory:[0],shownHistoryCursor:0,nextAutoAt:null,lastReliableBpm:0,scheduledTempo:null,transStart:0,durationMs:0,transitionId:'crossfade',transitionShaderId:transitionShaderId('crossfade'),seed:0,param:[0,0,0,0],easing:'linear',lastSwitch:performance.now(),lastMappedSignal:0}}
function orderedImages(a,enabledOnly=false){
 const {imageConfigs, IMAGE_SETS}=getRuntime();
 return imageConfigs[a].images.map((im,i)=>({i,order:im.order,enabled:im.enabled&&!IMAGE_SETS[a]?.[i]?.missing})).filter(x=>!enabledOnly||x.enabled).sort((x,y)=>x.order-y.order||x.i-y.i).map(x=>x.i);
}
function enabledImages(a){
return orderedImages(a,true)}
function chooseOrderedImage(a,direction=1){
 const {imageConfigs}=getRuntime();
 const s=seqStates[a],mode=imageConfigs[a].orderMode;
 if((mode==='random-no-repeat'||mode==='shuffle')&&direction<0){s.shownHistoryCursor=Math.max(0,s.shownHistoryCursor-1);return s.shownHistory[s.shownHistoryCursor]??s.current}
 if((mode==='random-no-repeat'||mode==='shuffle')&&s.shownHistoryCursor<s.shownHistory.length-1){s.shownHistoryCursor+=1;return s.shownHistory[s.shownHistoryCursor]}
 const result=nextSequenceIndex({enabled:enabledImages(a),current:navigationBase(s),direction,mode,state:s.orderState});
 s.orderState=result.state;return result.index;
}
function sequenceTempo(a){
 const {BPM, BPMConfidence}=getRuntime();
 const s=seqStates[a],tempo=resolveSequencerTempo({bpm:BPM,confidence:BPMConfidence,lastReliableBpm:s.lastReliableBpm});
 s.lastReliableBpm=tempo.lastReliableBpm;return tempo;
}
function imageDwell(a,index,tempo=sequenceTempo(a)){
 const {imageConfigs}=getRuntime();
 const cfg=imageConfigs[a],image=cfg.images[index];
 if(cfg.timeBase==='beats'){
   const requested=image.durationBeats||4,effective=effectiveBeatDwell(requested,tempo.bpm);
   return {seconds:beatsToSeconds(effective,tempo.bpm),requestedBeats:requested,effectiveBeats:effective,tempo};
 }
 return {seconds:Math.max(2,image.duration||10),tempo};
}
function mappedSourceValue(name,Eff){
 const {BeatPulse, KickFast, SnareFast}=getRuntime();
 if(name==='energy')return Eff.energy;if(name==='density')return Eff.density;if(name==='drive')return Eff.drive;
 if(name==='boombap')return Eff.boombap;if(name==='tension')return Eff.tension;if(name==='bright')return Eff.bright;if(name==='open')return Eff.open;
 if(name==='beat')return BeatPulse;if(name==='kick')return KickFast;if(name==='snare')return SnareFast;
 return Eff.energy;
}
function mappedSourceIsEvent(name){
return name==='beat'||name==='kick'||name==='snare'}
function navigationBase(s){
return s.pendingRequest?.idx??s.loadingTarget??(s.transitioning?s.next:s.current)}
function createSequenceTransition(a,from,to,triggerClass){
 const {imageConfigs}=getRuntime();
 const cfg=imageConfigs[a],settings=cfg.triggers[triggerClass],s=seqStates[a],pick=pickTransitionFromPool(settings,s.poolStates[triggerClass]);s.poolStates[triggerClass]=pick.state;
 const tempo=sequenceTempo(a),configuredDwell=cfg.images[from]?.duration||10;
 const dwell=cfg.timeBase==='beats'?imageDwell(a,from,tempo).seconds:(cfg.mode==='mapped'&&triggerClass!=='manual'?Math.max(1,Math.min(8,configuredDwell)):Math.max(2,configuredDwell));
 const requestedDuration=cfg.timeBase==='beats'?beatsToSeconds(settings.durationBeats,tempo.bpm):settings.duration,duration=effectiveTransitionDuration(requestedDuration,dwell);
 const transitionId=transitionRunsAsCut(pick.id,duration)?'cut':pick.id,seed=Math.random()*1000;
 return {archetype:a,from,to,triggerClass,transitionId,transitionShaderId:transitionShaderId(transitionId),seed,param:resolveTransitionParam(transitionId,settings.wipeDirection,seed),easing:settings.easing,duration:transitionId==='cut'?0:duration};
}
function beginSequenceTransition(s,transition,now,initialRawProgress=0){

 s.current=transition.from;s.next=transition.to;s.rawProgress=Math.max(0,Math.min(1,initialRawProgress));s.blend=applyTransitionEasing(s.rawProgress,transition.easing);
 s.transStart=now-s.rawProgress*transition.duration*1000;s.durationMs=transition.duration*1000;s.transitioning=true;s.loading=false;
 s.transitionId=transition.transitionId;s.transitionShaderId=transition.transitionShaderId??transitionShaderId(transition.transitionId);s.seed=transition.seed;s.param=[...transition.param];s.easing=transition.easing;
}
function advanceSequenceTransition(role,a,now){
 const s=seqStates[a];if(!s?.transitioning)return false;
 s.rawProgress=s.durationMs>0?Math.min(1,(now-s.transStart)/s.durationMs):1;
 s.blend=s.transitionId==='cut'?1:applyTransitionEasing(s.rawProgress,s.easing);
 if(s.rawProgress<1)return false;
 swapTextureSlots(role);s.current=s.next;s.blend=0;s.rawProgress=0;s.transitioning=false;s.lastSwitch=now;s.nextAutoAt=null;
 {s.shownHistory=s.shownHistory.slice(0,s.shownHistoryCursor+1);if(s.shownHistory.at(-1)!==s.current)s.shownHistory.push(s.current);s.shownHistoryCursor=s.shownHistory.length-1}

 return true;
}
function completeSequenceTransition(role,a,now=performance.now()){

 const s=seqStates[a];if(!s?.transitioning)return false;
 s.transStart=now-s.durationMs;s.rawProgress=1;return advanceSequenceTransition(role,a,now);
}
async function requestImageChange(a,idx,triggerClass=null){
 const {imageConfigs, projectSwitching, deletingArchetype, panicActive,archetypeSelectionBusy,mediaGeneration}=getRuntime();
 const s=seqStates[a];
 if(projectSwitching||deletingArchetype||archetypeSelectionBusy||panicActive||!imageConfigs[a].images[idx]?.enabled)return;
 triggerClass=triggerClass||classifyImageTrigger(imageConfigs[a]);
 const request={idx,triggerClass};
 if(s.loading){s.pendingRequest=resolvePendingImageRequest(s.pendingRequest,request);return}
 if(s.transitioning)completeSequenceTransition(1,a);
 if(idx===s.current)return;
 s.loading=true;s.loadingTarget=idx;
 await trackedMediaLoad(1,1,a,idx);
 if(getRuntime().projectSwitching||getRuntime().disposed||getRuntime().mediaGeneration!==mediaGeneration){s.loading=false;s.loadingTarget=null;s.pendingRequest=null;return}
 s.loading=false;s.loadingTarget=null;
 if(getRuntime().panicActive){s.pendingRequest=null;return}
 if(s.pendingRequest){const pending=s.pendingRequest;s.pendingRequest=null;if(pending.idx!==idx){requestImageChange(a,pending.idx,pending.triggerClass);return}triggerClass=pending.triggerClass}
 const now=performance.now(),transition=createSequenceTransition(a,s.current,idx,triggerClass);beginSequenceTransition(s,transition,now);
 if(s.transitionId==='cut')advanceSequenceTransition(1,a,now);
}
function updateImageSequence(now,Eff,freezeAdvances=false){
 const {imageConfigs, target, beatAnchorSec}=getRuntime();
 const a=target,s=seqStates[a],cfg=imageConfigs[a];
 if(s.transitioning){advanceSequenceTransition(1,a,now);return}
 if(freezeAdvances)return;
 const enabled=enabledImages(a);if(enabled.length<2)return;
 if(cfg.mode==='auto'){
   if(s.nextAutoAt==null){
     const dwell=imageDwell(a,s.current),earliest=s.lastSwitch/1000+Math.max(2,dwell.seconds);
     s.scheduledTempo=dwell.tempo;
     s.nextAutoAt=(cfg.timeBase==='beats'?quantizeToBeatGrid(earliest,beatAnchorSec??s.lastSwitch/1000,60/dwell.tempo.bpm):earliest)*1000;
   }
   if(now>=s.nextAutoAt){s.nextAutoAt=Infinity;requestImageChange(a,chooseOrderedImage(a,1),'timed')}
 }else if(cfg.mode==='mapped'){
   const v=clamp(mappedSourceValue(cfg.source,Eff),0,1);
   const minDwell=Math.max(1.0,Math.min(8,cfg.images[s.current].duration||3))*1000;
   if(mappedSourceIsEvent(cfg.source)){
     const th=cfg.threshold||.55;
     // Rising-edge trigger: each detected Beat/Kick/Snare event advances one image in the chosen order.
     if(v>=th && s.lastMappedSignal<th && now-s.lastSwitch>=minDwell)requestImageChange(a,chooseOrderedImage(a,1),'event');
     s.lastMappedSignal=v;
   }else{
     // Continuous musical state: low values use early images, high values later images.
     const desired=enabled[Math.min(enabled.length-1,Math.floor(v*enabled.length))];
     if(desired!==s.current&&now-s.lastSwitch>=minDwell)requestImageChange(a,desired,'timed');
     s.lastMappedSignal=v;
   }
 }
}
async function loadArchetypeIntoRole(role,a){

 const s=seqStates[a],e=enabledImages(a),i0=e.includes(s.current)?s.current:(e[0]??0),i1=s.transitioning?s.next:i0;
 const prepared=await renderer.prepareRole(role,a,i0,i1);
 return {commit(){s.current=i0;s.next=i1;prepared.commit()},discard:()=>prepared.discard()};
}
return {seqStates,createSequenceState,orderedImages,enabledImages,chooseOrderedImage,sequenceTempo,imageDwell,mappedSourceValue,mappedSourceIsEvent,navigationBase,createSequenceTransition,beginSequenceTransition,advanceSequenceTransition,completeSequenceTransition,requestImageChange,updateImageSequence,loadArchetypeIntoRole};
}
