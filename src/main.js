import './styles.css';
import { IMAGE_SETS, archetypes, routeSources, routeTargets, sourceLabels, targetLabels, defaultRoutingMaps, blankMap } from './config.js';
import { computeTargetState, NEUTRAL_TARGETS } from './routing.js';
import { vertexShaderSource, fragmentShaderSource } from './shaders.js';
import { customMediaSources, loadCustomArchetypes, saveCustomArchetype } from './custom-archetypes.js';
import { resolvePerformanceShortcut } from './shortcuts.js';
import { applyPanicTargets } from './show-safety.js';

const isShowMode=new URLSearchParams(location.search).get('show')==='1';
document.body.classList.toggle('showMode',isShowMode);
const showChannel='BroadcastChannel' in window?new BroadcastChannel('eyesforbeats-show-v1'):null;
let remoteVisualState=null,lastShowPeerAt=0,showWindow=null,lastShowBroadcastAt=0;
let blackoutActive=false,panicActive=false,panicReleaseStartedAt=null;
if(isShowMode){
 const status=document.createElement('div');status.id='showConnection';status.className='showConnection';status.textContent='WAITING FOR CONTROLLER';document.body.appendChild(status);
 const announce=()=>showChannel?.postMessage({type:'show-ready'});announce();setInterval(announce,2000);
 document.addEventListener('dblclick',()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{})});
 document.addEventListener('keydown',event=>{if(event.key.toLowerCase()==='f'&&!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{})});
}
showChannel?.addEventListener('message',event=>{
 const message=event.data||{};
 if(isShowMode&&message.type==='frame'){remoteVisualState=message.state;document.getElementById('showConnection')?.classList.add('connected')}
 if(isShowMode&&message.type==='library-changed')location.reload();
 if(!isShowMode&&message.type==='show-ready')lastShowPeerAt=Date.now();
});

const builtInArchetypeCount=archetypes.length;
try{
 const storedArchetypes=await loadCustomArchetypes();
 storedArchetypes.forEach(record=>{
   const template=Math.max(0,Math.min(builtInArchetypeCount-1,record.templateIndex||0));
   archetypes.push({name:record.name,behavior:{...archetypes[template].behavior},customId:record.id,templateIndex:template});
   IMAGE_SETS.push(customMediaSources(record));
   defaultRoutingMaps.push(JSON.parse(JSON.stringify(defaultRoutingMaps[template])));
 });
}catch(error){console.error('Unable to load custom archetypes',error)}
let routingMaps=JSON.parse(JSON.stringify(defaultRoutingMaps));
try{
 const candidates=[
   localStorage.getItem('arv_v043_routing_maps'),
   localStorage.getItem('arv_v042_routing_maps'),
   localStorage.getItem('arv_v041_routing_maps')
 ].filter(Boolean);
 for(const saved of candidates){
   try{
     const p=JSON.parse(saved);
     if(!Array.isArray(p)) continue;
     if(p.length>=6){ routingMaps=p; break; }
     if(p.length===5){ routingMaps=p.map((m)=>{const n=blankMap();routeSources.forEach(s=>routeTargets.forEach(t=>{if(m&&m[s]&&m[s][t]!=null)n[s][t]=m[s][t]}));return n}); routingMaps.push(JSON.parse(JSON.stringify(defaultRoutingMaps[5]))); break; }
     if(p.length===4){ routingMaps=p.map((m)=>{const n=blankMap();routeSources.forEach(s=>routeTargets.forEach(t=>{if(m&&m[s]&&m[s][t]!=null)n[s][t]=m[s][t]}));return n}); routingMaps.push(JSON.parse(JSON.stringify(defaultRoutingMaps[4]))); routingMaps.push(JSON.parse(JSON.stringify(defaultRoutingMaps[5]))); break; }
   }catch(err){}
 }
 // normalize shape
 routingMaps=archetypes.map((_,i)=>{
   const src=routingMaps[i]||defaultRoutingMaps[i];
   const n=blankMap();
   routeSources.forEach(s=>routeTargets.forEach(t=>{ if(src&&src[s]&&src[s][t]!=null) n[s][t]=src[s][t]; }));
   return n;
 });
}catch(e){}
function saveRoutingMaps(){try{localStorage.setItem('arv_v043_routing_maps',JSON.stringify(routingMaps))}catch(e){}}
function renderMatrixEditor(){
 const a=(typeof target==='number')?target:0;document.getElementById('matrixArchName').textContent=archetypes[a].name;
 let h='<table class="mapTable"><thead><tr><th>SOURCE ↓ / TARGET →</th>';routeTargets.forEach(t=>h+='<th>'+targetLabels[t]+'</th>');h+='</tr></thead><tbody>';
 routeSources.forEach(s=>{h+='<tr><td class="srcLabel">'+sourceLabels[s]+'</td>';routeTargets.forEach(t=>{const v=Number(routingMaps[a][s][t]||0);h+='<td><input class="mapCell '+(Math.abs(v)>.001?'nz':'')+'" data-s="'+s+'" data-t="'+t+'" type="number" min="-1.5" max="1.5" step="0.05" value="'+v.toFixed(2)+'"></td>'});h+='</tr>'});h+='</tbody></table>';
 document.getElementById('matrixHolder').innerHTML=h;document.querySelectorAll('.mapCell').forEach(el=>{el.oninput=()=>{const v=Math.max(-1.5,Math.min(1.5,parseFloat(el.value)||0));routingMaps[a][el.dataset.s][el.dataset.t]=v;el.classList.toggle('nz',Math.abs(v)>.001);saveRoutingMaps()}})
}
function closeMappingMatrix(){saveRoutingMaps();document.getElementById('matrixPanel').classList.remove('open')}
document.getElementById('openMatrix').onclick=()=>{closeImageManager();renderMatrixEditor();document.getElementById('matrixPanel').classList.add('open')};
document.getElementById('closeMatrix').onclick=closeMappingMatrix;
document.getElementById('applyCloseMatrix').onclick=closeMappingMatrix;
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'){
   if(document.getElementById('matrixPanel').classList.contains('open'))closeMappingMatrix();
   if(document.getElementById('imagePanel').classList.contains('open'))closeImageManager();
   if(document.getElementById('creatorPanel').classList.contains('open'))closeArchetypeCreator();
 }
});
document.getElementById('zeroMap').onclick=()=>{routingMaps[target]=blankMap();saveRoutingMaps();renderMatrixEditor()};
document.getElementById('resetMap').onclick=()=>{routingMaps[target]=JSON.parse(JSON.stringify(defaultRoutingMaps[target]));saveRoutingMaps();renderMatrixEditor()};

const modState = {
 enabled:{energy:true,density:true,drive:true,boombap:true,tension:true,bright:true,open:true,beat:true,kick:true,snare:true},
 solo:{energy:false,density:false,drive:false,boombap:false,tension:false,bright:false,open:false,beat:false,kick:false,snare:false}
};
const neutralVals = {energy:0,density:0,drive:0,boombap:0,tension:0,bright:0,open:0.60};
const sourceKeys=['energy','density','drive','boombap','tension','bright','open','beat','kick','snare'];
const globalCtl = {
 pulse:document.getElementById('g-pulse'),
 dist:document.getElementById('g-dist'),
 glow:document.getElementById('g-glow'),
 luma:document.getElementById('g-luma'),
 sat:document.getElementById('g-sat'),
 parts:document.getElementById('g-parts'),
 zoom:document.getElementById('g-zoom')
};
const globalAuto = {
 pulse:document.getElementById('ga-pulse'),
 dist:document.getElementById('ga-dist'),
 glow:document.getElementById('ga-glow'),
 luma:document.getElementById('ga-luma'),
 sat:document.getElementById('ga-sat'),
 parts:document.getElementById('ga-parts'),
 zoom:document.getElementById('ga-zoom')
};
let FinalG={...NEUTRAL_TARGETS};

const ctxPerf=document.getElementById('ctxPerf'), ctxPerfVal=document.getElementById('ctxPerfVal');
ctxPerf.oninput=()=>ctxPerfVal.textContent=(+ctxPerf.value).toFixed(2);

ctxPerfVal.textContent=(+ctxPerf.value).toFixed(2);
sourceKeys.forEach(k=>{
  const amt=document.getElementById('amt-'+k), out=document.getElementById('show-'+k);
  amt.oninput=()=>out.textContent=(+amt.value).toFixed(2);
  out.textContent=(+amt.value).toFixed(2);
});
document.querySelectorAll('[data-on]').forEach(input=>input.onchange=()=>{
  const k=input.dataset.on;modState.enabled[k]=input.checked;
});
document.querySelectorAll('[data-solo]').forEach(btn=>btn.onclick=()=>{
  const k=btn.dataset.solo; modState.solo[k]=!modState.solo[k];
  btn.classList.toggle('active',modState.solo[k]);
});

let musicPresets=archetypes.map(()=>[]);
try{
  const saved=JSON.parse(localStorage.getItem('arv_v044_music_presets')||'null');
  if(Array.isArray(saved))musicPresets=archetypes.map((_,i)=>Array.isArray(saved[i])?saved[i]:[]);
}catch(e){}
function saveMusicPresets(){try{localStorage.setItem('arv_v044_music_presets',JSON.stringify(musicPresets))}catch(e){}}
function captureMusicPreset(name){
  const amounts={};sourceKeys.forEach(k=>amounts[k]=+document.getElementById('amt-'+k).value);
  const intensity={},reactivity={};routeTargets.forEach(k=>{intensity[k]=+globalCtl[k].value;reactivity[k]=+globalAuto[k].value});
  return {name,enabled:{...modState.enabled},solo:{...modState.solo},amounts,intensity,reactivity,ctxPerf:+ctxPerf.value,globalReact:+document.getElementById('react').value,routing:JSON.parse(JSON.stringify(routingMaps[target]))};
}
function applyMusicPreset(p){
  if(!p)return;
  sourceKeys.forEach(k=>{
    modState.enabled[k]=p.enabled?.[k]!==false;modState.solo[k]=!!p.solo?.[k];
    const amt=document.getElementById('amt-'+k);if(p.amounts?.[k]!=null)amt.value=p.amounts[k];document.getElementById('show-'+k).textContent=(+amt.value).toFixed(2);
    const on=document.querySelector('[data-on="'+k+'"]'),solo=document.querySelector('[data-solo="'+k+'"]');on.checked=modState.enabled[k];solo.classList.toggle('active',modState.solo[k]);
  });
  routeTargets.forEach(k=>{if(p.intensity?.[k]!=null)globalCtl[k].value=p.intensity[k];if(p.reactivity?.[k]!=null)globalAuto[k].value=p.reactivity[k]});
  if(p.ctxPerf!=null){ctxPerf.value=p.ctxPerf;ctxPerfVal.textContent=(+ctxPerf.value).toFixed(2)}
  if(p.globalReact!=null)document.getElementById('react').value=String(p.globalReact);
  if(p.routing)routingMaps[target]=JSON.parse(JSON.stringify(p.routing));
  saveRoutingMaps();
  if(document.getElementById('matrixPanel').classList.contains('open'))renderMatrixEditor();
}
function syncPresetActions(){
  const hasSelection=document.getElementById('presetSelect').value!=='';
  document.getElementById('presetUpdate').disabled=!hasSelection;
  document.getElementById('presetDelete').disabled=!hasSelection;
}
function renderPresetControls(selectedIndex=''){
  const select=document.getElementById('presetSelect'),items=musicPresets[target]||[];select.innerHTML='';
  const empty=document.createElement('option');empty.value='';empty.textContent=items.length?'SELECT MUSICAL PRESET':'NO SAVED PRESET';select.appendChild(empty);
  items.forEach((p,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=p.name;select.appendChild(o)});
  if(selectedIndex!==''&&items[+selectedIndex])select.value=String(selectedIndex);
  syncPresetActions();
}
const presetDialog=document.getElementById('presetDialog'),newPresetName=document.getElementById('newPresetName');
document.getElementById('presetSave').onclick=()=>{newPresetName.value='';presetDialog.showModal();requestAnimationFrame(()=>newPresetName.focus())};
document.getElementById('cancelPreset').onclick=()=>presetDialog.close();
document.getElementById('presetDialogForm').onsubmit=e=>{
  e.preventDefault();const name=newPresetName.value.trim();if(!name){newPresetName.focus();return}
  musicPresets[target].push(captureMusicPreset(name));saveMusicPresets();renderPresetControls(musicPresets[target].length-1);presetDialog.close();
};
document.getElementById('presetSelect').onchange=e=>{const i=e.target.value;if(i!=='')applyMusicPreset(musicPresets[target][+i]);syncPresetActions()};
function activatePreset(index){
 const items=musicPresets[target]||[];
 if(!items.length){showShortcutToast('NO PRESETS FOR THIS ARCHETYPE');return false}
 if(index<0||index>=items.length){showShortcutToast('PRESET '+String(index+1).padStart(2,'0')+' NOT AVAILABLE');return false}
 const select=document.getElementById('presetSelect');select.value=String(index);applyMusicPreset(items[index]);syncPresetActions();
 showShortcutToast('PRESET '+String(index+1).padStart(2,'0')+' · '+items[index].name);return true;
}
function stepPreset(direction){
 const items=musicPresets[target]||[];
 if(!items.length){showShortcutToast('NO PRESETS FOR THIS ARCHETYPE');return}
 const value=document.getElementById('presetSelect').value;
 const index=value===''?(direction>0?0:items.length-1):(+value+direction+items.length)%items.length;
 activatePreset(index);
}
document.getElementById('presetUpdate').onclick=()=>{
  const select=document.getElementById('presetSelect'),i=select.value;if(i==='')return;
  const name=musicPresets[target][+i].name;musicPresets[target][+i]=captureMusicPreset(name);saveMusicPresets();renderPresetControls(i);
};
document.getElementById('presetDelete').onclick=()=>{const select=document.getElementById('presetSelect'),i=select.value;if(i==='')return;musicPresets[target].splice(+i,1);saveMusicPresets();renderPresetControls()};
function getEffectiveState(){
  const anySolo = Object.values(modState.solo).some(Boolean);
  const out = {};
  ['energy','density','drive','boombap','tension','bright','open'].forEach(k=>{
    const active = anySolo ? modState.solo[k] : modState.enabled[k];
    const amt = +document.getElementById('amt-'+k).value;
    const m = active ? amt : 0;
    out[k] = neutralVals[k] + (S[k]-neutralVals[k]) * m;
  });
  return out;
}

function sourceActive(k){
  const anySolo=Object.values(modState.solo).some(Boolean);
  return anySolo ? modState.solo[k] : modState.enabled[k];
}
function centered(Eff,k){
  if(!sourceActive(k)) return 0;
  return Eff[k]-0.5;
}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

function computeGlobalMapping(Eff,now){
  const map=routingMaps[target];
  const live=!!analyser&&!audio.paused;
  const amount=k=>+(document.getElementById('amt-'+k)?.value||0);
  const continuous={energy:Eff.energy,density:Eff.density,drive:Eff.drive,boombap:Eff.boombap,tension:Eff.tension,bright:Eff.bright,open:Eff.open};
  const rawSrc={},activeSrc={};
  routeSources.forEach(k=>{
    activeSrc[k]=live&&sourceActive(k);
    if(!activeSrc[k]){rawSrc[k]=0;return}
    let v;if(k==='beat')v=BeatPulse*amount(k);else if(k==='kick')v=KickFast*amount(k);else if(k==='snare')v=SnareFast*amount(k);else v=continuous[k];
    rawSrc[k]=clamp(v,0,1.5);
  });
  const intensity={},reactivity={};
  routeTargets.forEach(k=>{intensity[k]=+globalCtl[k].value;reactivity[k]=+globalAuto[k].value});
  FinalG=computeTargetState({map,sources:rawSrc,activeSources:activeSrc,intensity,reactivity,globalReactivity:+document.getElementById('react').value});
  ['pulse','dist','glow','luma','sat','parts','zoom'].forEach(k=>document.getElementById('gf-'+k).textContent=FinalG[k].toFixed(2));
  return FinalG;
}


function visualProfileIndex(index){return archetypes[index]?.templateIndex??index}
function mediaUrl(source){return typeof source==='string'?source:source.url}
function mediaIsVideo(source){return typeof source!=='string'&&source.type?.startsWith('video/')}
function createDefaultImageConfig(idx){
 const profile=visualProfileIndex(idx),count=IMAGE_SETS[idx].length;
 return {
 mode:'auto',source:profile===0?'open':profile===1?'drive':profile===2?'bright':profile===3?'energy':'boombap',
 crossfade:2.2,threshold:.55,
 images:Array.from({length:count},(_,i)=>({enabled:true,duration:[10,10,12,9,11][i%5],order:i}))
 }}
const defaultImageConfigs=archetypes.map((_,idx)=>createDefaultImageConfig(idx));
let imageConfigs=JSON.parse(JSON.stringify(defaultImageConfigs));
function normalizeImageConfigs(configs){
 return archetypes.map((a,ai)=>{
   const base=JSON.parse(JSON.stringify(defaultImageConfigs[ai]));
   const c=(configs&&configs[ai])?configs[ai]:{};
   base.mode=['auto','manual','mapped'].includes(c.mode)?c.mode:base.mode;
   base.source=c.source||base.source;base.crossfade=clamp(parseFloat(c.crossfade)||base.crossfade,.2,8);base.threshold=clamp(parseFloat(c.threshold)||.55,.05,.95);
   base.images=Array.from({length:IMAGE_SETS[ai].length},(_,i)=>{
     const old=(c.images&&c.images[i])?c.images[i]:{};
     return {enabled:old.enabled!==false,duration:clamp(parseFloat(old.duration)||[10,10,12,9,11][i%5],2,60),order:Number.isFinite(+old.order)?+old.order:i};
   });
   // Normalize order while preserving the user's relative order.
   const sorted=base.images.map((im,i)=>({i,o:im.order})).sort((x,y)=>x.o-y.o||x.i-y.i);
   sorted.forEach((x,pos)=>base.images[x.i].order=pos);
   return base;
 });
}
try{
 let s=localStorage.getItem('arv_v043_image_configs');
 if(!s)s=localStorage.getItem('arv_v042b_image_configs');
 if(!s)s=localStorage.getItem('arv_v042_image_configs');
 if(s){const p=JSON.parse(s);if(Array.isArray(p))imageConfigs=normalizeImageConfigs(p)}
}catch(e){}
imageConfigs=normalizeImageConfigs(imageConfigs);
function saveImageConfigs(){try{localStorage.setItem('arv_v043_image_configs',JSON.stringify(imageConfigs))}catch(e){}}
const seqStates=archetypes.map(()=>({current:0,next:1,blend:0,transitioning:false,loading:false,transStart:0,lastSwitch:performance.now(),lastMappedSignal:0}));
function orderedImages(a,enabledOnly=false){
 return imageConfigs[a].images.map((im,i)=>({i,order:im.order,enabled:im.enabled})).filter(x=>!enabledOnly||x.enabled).sort((x,y)=>x.order-y.order||x.i-y.i).map(x=>x.i);
}
function enabledImages(a){return orderedImages(a,true)}
function nextEnabled(a,from,dir=1){
 const e=enabledImages(a);if(!e.length)return 0;
 let pos=e.indexOf(from);if(pos<0)pos=dir>0?-1:0;
 return e[(pos+dir+e.length)%e.length];
}
function moveImageToPosition(a,imgIdx,newPos){
 const seq=orderedImages(a,false).filter(i=>i!==imgIdx);
 newPos=Math.max(0,Math.min(imageConfigs[a].images.length-1,newPos));seq.splice(newPos,0,imgIdx);
 seq.forEach((i,p)=>imageConfigs[a].images[i].order=p);saveImageConfigs();
}
function moveImageBy(a,imgIdx,delta){
 const seq=orderedImages(a,false),pos=seq.indexOf(imgIdx);if(pos<0)return;
 moveImageToPosition(a,imgIdx,pos+delta);
}
function mappedSourceValue(name,Eff){
 if(name==='energy')return Eff.energy;if(name==='density')return Eff.density;if(name==='drive')return Eff.drive;
 if(name==='boombap')return Eff.boombap;if(name==='tension')return Eff.tension;if(name==='bright')return Eff.bright;if(name==='open')return Eff.open;
 if(name==='beat')return BeatPulse;if(name==='kick')return KickFast;if(name==='snare')return SnareFast;
 return Eff.energy;
}
function mappedSourceIsEvent(name){return name==='beat'||name==='kick'||name==='snare'}
function renderImageManager(){
 const a=target,cfg=imageConfigs[a],s=seqStates[a];
 document.getElementById('imageArchName').textContent=archetypes[a].name;
 document.getElementById('imageMode').value=cfg.mode;
 document.getElementById('imageSource').value=cfg.source;
 document.getElementById('imageCrossfade').value=cfg.crossfade;
 document.getElementById('imageThreshold').value=cfg.threshold;
 let h='';
 const visualOrder=orderedImages(a,false);
 visualOrder.forEach((i,pos)=>{
   const im=cfg.images[i];
   let opts='';for(let p=0;p<cfg.images.length;p++)opts+='<option value="'+p+'" '+(p===pos?'selected':'')+'>'+(p+1)+'</option>';
   const source=IMAGE_SETS[a][i],preview=mediaIsVideo(source)?'<video class="imageThumb" src="'+mediaUrl(source)+'" muted loop playsinline autoplay></video>':'<img class="imageThumb" src="'+mediaUrl(source)+'">';
   h+='<div class="imageCard '+(s.current===i?'current':'')+'" data-imgcard="'+i+'">'+preview+'<div class="cardLine"><b>'+(mediaIsVideo(source)?'VIDEO ':'IMAGE ')+(i+1)+'</b><label><input type="checkbox" data-imgen="'+i+'" '+(im.enabled?'checked':'')+'> ON</label></div><div class="cardLine"><span>Dwell sec</span><input type="number" data-imgdur="'+i+'" min="2" max="60" step="1" value="'+im.duration+'"></div><div class="cardLine"><span>Order</span><div class="orderCtl"><button data-imgup="'+i+'">▲</button><select data-imgorder="'+i+'">'+opts+'</select><button data-imgdown="'+i+'">▼</button></div></div></div>';
 });
 document.getElementById('imageGrid').innerHTML=h;
 const active=enabledImages(a),orderPos=active.indexOf(s.current);
 document.getElementById('imageManagerStatus').textContent='Current IMAGE '+(s.current+1)+' · active position '+(orderPos>=0?orderPos+1:'—')+' / '+active.length+' · mode '+cfg.mode.toUpperCase();
 document.querySelectorAll('[data-imgen]').forEach(el=>el.onchange=()=>{
   const i=+el.dataset.imgen;
   imageConfigs[a].images[i].enabled=el.checked;
   if(!enabledImages(a).length){imageConfigs[a].images[i].enabled=true;el.checked=true}
   saveImageConfigs();
   if(!imageConfigs[a].images[s.current].enabled){const nxt=enabledImages(a)[0];if(nxt!=null)requestImageChange(a,nxt)}
 });
 document.querySelectorAll('[data-imgdur]').forEach(el=>el.onchange=()=>{
   const i=+el.dataset.imgdur;imageConfigs[a].images[i].duration=clamp(parseFloat(el.value)||10,2,60);el.value=imageConfigs[a].images[i].duration;saveImageConfigs();
 });
 document.querySelectorAll('[data-imgorder]').forEach(el=>el.onchange=()=>{moveImageToPosition(a,+el.dataset.imgorder,+el.value);renderImageManager()});
 document.querySelectorAll('[data-imgup]').forEach(el=>el.onclick=()=>{moveImageBy(a,+el.dataset.imgup,-1);renderImageManager()});
 document.querySelectorAll('[data-imgdown]').forEach(el=>el.onclick=()=>{moveImageBy(a,+el.dataset.imgdown,1);renderImageManager()});
}
function closeImageManager(){saveImageConfigs();document.getElementById('imagePanel').classList.remove('open')}
document.getElementById('imageMgrBtn').onclick=()=>{closeMappingMatrix();renderImageManager();document.getElementById('imagePanel').classList.add('open')};
document.getElementById('closeImageMgr').onclick=closeImageManager;
document.getElementById('applyCloseImageMgr').onclick=closeImageManager;
document.getElementById('imageMode').onchange=e=>{imageConfigs[target].mode=e.target.value;seqStates[target].lastSwitch=performance.now();seqStates[target].lastMappedSignal=0;saveImageConfigs();renderImageManager()};
document.getElementById('imageSource').onchange=e=>{imageConfigs[target].source=e.target.value;seqStates[target].lastMappedSignal=0;saveImageConfigs()};
document.getElementById('imageCrossfade').onchange=e=>{imageConfigs[target].crossfade=clamp(parseFloat(e.target.value)||2.2,.2,8);e.target.value=imageConfigs[target].crossfade;saveImageConfigs()};
document.getElementById('imageThreshold').onchange=e=>{imageConfigs[target].threshold=clamp(parseFloat(e.target.value)||.55,.05,.95);e.target.value=imageConfigs[target].threshold;saveImageConfigs()};
document.getElementById('imgPrev').onclick=()=>requestImageChange(target,nextEnabled(target,seqStates[target].current,-1));
document.getElementById('imgNext').onclick=()=>requestImageChange(target,nextEnabled(target,seqStates[target].current,1));

const creatorPanel=document.getElementById('creatorPanel');
const creatorFiles=document.getElementById('customArchFiles');
const creatorPreview=document.getElementById('customArchPreview');
const creatorStatus=document.getElementById('creatorStatus');
const creatorUploadFields=document.getElementById('creatorUploadFields');
const creatorAiFields=document.getElementById('creatorAiFields');
const creatorUploadMode=document.getElementById('creatorUploadMode');
const creatorAiMode=document.getElementById('creatorAiMode');
const creatorGenerateButton=document.getElementById('generateArchetypeImages');
const creatorCost=document.getElementById('customArchCost');
let pendingArchetypeFiles=[],previewUrls=[];
function resetCreatorPreview(){previewUrls.forEach(URL.revokeObjectURL);previewUrls=[];creatorPreview.innerHTML=''}
function renderCreatorPreview(){
 resetCreatorPreview();
 pendingArchetypeFiles.forEach((file,index)=>{
   const url=URL.createObjectURL(file);previewUrls.push(url);
   const card=document.createElement('div');card.className='creatorPreviewCard';
   const element=document.createElement(file.type.startsWith('video/')?'video':'img');element.src=url;element.title=file.name;
   if(element.tagName==='VIDEO'){element.muted=true;element.loop=true;element.playsInline=true;element.autoplay=true}
   const remove=document.createElement('button');remove.type='button';remove.className='creatorRemoveMedia';remove.textContent='×';remove.title='Remove from archetype';remove.setAttribute('aria-label','Remove '+file.name);
   remove.onclick=()=>{pendingArchetypeFiles.splice(index,1);renderCreatorPreview();creatorStatus.textContent=pendingArchetypeFiles.length?'Ready to create.':'Select or generate at least one image.'};
   card.append(element,remove);creatorPreview.appendChild(card);
 });
}
function setCreatorMode(mode){
 const ai=mode==='ai';creatorUploadFields.hidden=ai;creatorAiFields.hidden=!ai;
 creatorUploadMode.classList.toggle('active',!ai);creatorAiMode.classList.toggle('active',ai);
 creatorStatus.textContent=pendingArchetypeFiles.length?'Ready to create.':ai?'Describe a visual direction, then generate.':'Select at least one image or video.';
}
function closeArchetypeCreator(){creatorPanel.classList.remove('open');resetCreatorPreview();creatorFiles.value='';pendingArchetypeFiles=[];document.getElementById('customArchFileCount').textContent='No media selected';setCreatorMode('upload')}
function openArchetypeCreator(){
 closeImageManager();closeMappingMatrix();
 const select=document.getElementById('customArchTemplate');select.innerHTML='';
 archetypes.slice(0,builtInArchetypeCount).forEach((arch,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=arch.name;select.appendChild(option)});
 creatorPanel.classList.add('open');
}
document.getElementById('closeCreator').onclick=closeArchetypeCreator;
creatorUploadMode.onclick=()=>setCreatorMode('upload');
creatorAiMode.onclick=()=>setCreatorMode('ai');
creatorFiles.onchange=()=>{
 const supported=[...creatorFiles.files].filter(file=>file.type.startsWith('image/')||file.type.startsWith('video/')).slice(0,24);
 const oversized=supported.filter(file=>file.type.startsWith('video/')&&file.size>25*1024*1024);
 pendingArchetypeFiles=supported.filter(file=>!oversized.includes(file));
 const totalBytes=pendingArchetypeFiles.reduce((sum,file)=>sum+file.size,0);
 if(totalBytes>100*1024*1024){pendingArchetypeFiles=[];creatorStatus.textContent='Selection exceeds the 100 MB total limit.'}
 document.getElementById('customArchFileCount').textContent=pendingArchetypeFiles.length?pendingArchetypeFiles.length+' media selected':'No media selected';
 renderCreatorPreview();
 if(oversized.length)creatorStatus.textContent=oversized.length+' video skipped (25 MB maximum each).';
 else if(pendingArchetypeFiles.length)creatorStatus.textContent='Ready to create.';
 else if(totalBytes<=100*1024*1024)creatorStatus.textContent='Select at least one image or video.';
};
const imageCosts={low:.013,medium:.05,high:.20};
function updateCreatorCost(){
 const count=+document.getElementById('customArchImageCount').value,quality=document.getElementById('customArchImageQuality').value;
 creatorCost.textContent='Estimated generation cost: about $'+(count*imageCosts[quality]).toFixed(2);
}
document.getElementById('customArchImageCount').onchange=updateCreatorCost;
document.getElementById('customArchImageQuality').onchange=updateCreatorCost;
const creatorStopMotion=document.getElementById('customArchStopMotion'),creatorLoop=document.getElementById('customArchLoop');
creatorStopMotion.onchange=()=>{creatorLoop.disabled=!creatorStopMotion.checked;if(!creatorStopMotion.checked)creatorLoop.checked=false};
async function generatedImageFile(base64,mimeType,index){
 const response=await fetch(`data:${mimeType};base64,${base64}`),blob=await response.blob();
 return new File([blob],`generated-${Date.now()}-${index}.webp`,{type:mimeType});
}
creatorGenerateButton.onclick=async()=>{
 const prompt=document.getElementById('customArchPrompt').value.trim(),count=+document.getElementById('customArchImageCount').value,quality=document.getElementById('customArchImageQuality').value;
 const stopMotion=creatorStopMotion.checked,loop=stopMotion&&creatorLoop.checked;
 if(prompt.length<8){creatorStatus.textContent='Describe the visual direction in a little more detail.';return}
 creatorGenerateButton.disabled=true;document.getElementById('createArchetype').disabled=true;pendingArchetypeFiles=[];renderCreatorPreview();
 try{
   let previousImage='',firstImage='';
   for(let index=1;index<=count;index++){
     creatorStatus.textContent=`Generating image ${index} of ${count}…`;
     const response=await fetch('/api/generate-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,quality,sequencePosition:index,sequenceTotal:count,stopMotion,loop,previousImage:stopMotion?previousImage:undefined,firstImage:stopMotion&&loop?firstImage:undefined})});
     const result=await response.json().catch(()=>({}));
     if(!response.ok)throw new Error(result.error||'Image generation failed.');
     if(index===1)firstImage=result.image;previousImage=result.image;
     pendingArchetypeFiles.push(await generatedImageFile(result.image,result.mimeType||'image/webp',index));renderCreatorPreview();
   }
   creatorStatus.textContent=`${count} images generated. Remove any you do not want, then create the archetype.`;
 }catch(error){console.error(error);creatorStatus.textContent=error.message||'Image generation failed. Try again.'}
 finally{creatorGenerateButton.disabled=false;document.getElementById('createArchetype').disabled=false}
};
document.getElementById('createArchetype').onclick=async()=>{
 const name=document.getElementById('customArchName').value.trim(),templateIndex=+document.getElementById('customArchTemplate').value,button=document.getElementById('createArchetype');
 if(!name){creatorStatus.textContent='Give the archetype a name.';return}
 if(!pendingArchetypeFiles.length){creatorStatus.textContent='Select or generate at least one image.';return}
 button.disabled=true;creatorStatus.textContent='Saving media locally…';
 try{
   const record=await saveCustomArchetype({name,templateIndex,media:pendingArchetypeFiles});
   const template=Math.max(0,Math.min(builtInArchetypeCount-1,templateIndex));
   archetypes.push({name,behavior:{...archetypes[template].behavior},customId:record.id,templateIndex:template});
   IMAGE_SETS.push(customMediaSources(record));
   defaultRoutingMaps.push(JSON.parse(JSON.stringify(defaultRoutingMaps[template])));
   routingMaps.push(JSON.parse(JSON.stringify(defaultRoutingMaps[template])));
   const newIndex=archetypes.length-1,newConfig=createDefaultImageConfig(newIndex);
   defaultImageConfigs.push(JSON.parse(JSON.stringify(newConfig)));imageConfigs.push(newConfig);
   seqStates.push({current:0,next:Math.min(1,IMAGE_SETS[newIndex].length-1),blend:0,transitioning:false,loading:false,transStart:0,lastSwitch:performance.now(),lastMappedSignal:0});
   musicPresets.push([]);saveRoutingMaps();saveImageConfigs();saveMusicPresets();renderArchetypeBar();
   showChannel?.postMessage({type:'library-changed'});
   closeArchetypeCreator();document.getElementById('customArchName').value='';await selectArchetype(newIndex);
 }catch(error){console.error(error);creatorStatus.textContent='Could not save this archetype in the browser.'}
 finally{button.disabled=false}
};

const canvas=document.getElementById('gl');
const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,powerPreference:'high-performance'});
if(!gl) alert('WebGL2 is required. Try Chrome or Safari on a recent Mac.');
const pcanvas=document.getElementById('particles'),ctx=pcanvas.getContext('2d');

function sh(type,src){
 const shader=gl.createShader(type);gl.shaderSource(shader,src);gl.compileShader(shader);
 if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader)||'Unknown shader error';gl.deleteShader(shader);throw new Error(message)}
 return shader;
}
const requiredTextureUnits=4;
if(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)<requiredTextureUnits)throw new Error(`Eyes4Beat requires ${requiredTextureUnits} fragment texture units`);
const vertexShader=sh(gl.VERTEX_SHADER,vertexShaderSource),fragmentShader=sh(gl.FRAGMENT_SHADER,fragmentShaderSource);
const prog=gl.createProgram();gl.attachShader(prog,vertexShader);gl.attachShader(prog,fragmentShader);gl.linkProgram(prog);
if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(prog)||'WebGL program link failed');
gl.deleteShader(vertexShader);gl.deleteShader(fragmentShader);gl.useProgram(prog);
const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
const pos=gl.getAttribLocation(prog,'aPos');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);

const names=['uRes','uTime','uMorphA','uMorphB','uArchMix','uMapPulse','uDistAmt','uGlowAmt','uLumAmt','uSatAmt','uZoomAmt','uArchA','uArchB'];
const U={}; names.forEach(n=>U[n]=gl.getUniformLocation(prog,n));
const samplers=['tCurrentA','tCurrentB','tTargetA','tTargetB']; samplers.forEach((n,i)=>{U[n]=gl.getUniformLocation(prog,n);gl.uniform1i(U[n],i)});

const texObjs=Array.from({length:2},()=>[null,null]);
const texMedia=Array.from({length:2},()=>[null,null]);
function createTextureSlot(role,slot){
 const unit=role*2+slot;
 const tex=gl.createTexture();texObjs[role][slot]=tex;
 gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([12,16,22,255]));
}
for(let role=0;role<2;role++){createTextureSlot(role,0);createTextureSlot(role,1)}
function bindTextureSlot(role,slot){
 gl.activeTexture(gl.TEXTURE0+role*2+slot);gl.bindTexture(gl.TEXTURE_2D,texObjs[role][slot]);
}
function releaseTextureMedia(role,slot){
 const previous=texMedia[role][slot];
 if(previous instanceof HTMLVideoElement){previous.pause();previous.removeAttribute('src');previous.load()}
 texMedia[role][slot]=null;
}
function uploadMediaToSlot(role,slot,a,imgIdx){
 return new Promise(resolve=>{
   const source=IMAGE_SETS[a][imgIdx],url=mediaUrl(source);
   releaseTextureMedia(role,slot);
   if(mediaIsVideo(source)){
     const video=document.createElement('video');video.muted=true;video.loop=true;video.playsInline=true;video.preload='auto';
     video.onloadeddata=()=>{
       bindTextureSlot(role,slot);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);
       gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,video);
       texMedia[role][slot]=video;video.play().catch(()=>{});resolve();
     };
     video.onerror=()=>{console.error('Unable to load video',url);resolve()};
     video.src=url;video.load();return;
   }
   const img=new Image();
   img.onload=()=>{
     bindTextureSlot(role,slot);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);
     gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
     texMedia[role][slot]=img;
     resolve();
   };
   img.onerror=()=>{console.error('Unable to load image',url);resolve()};
   img.src=url;
 });
}
function swapTextureSlots(role){
 const tmp=texObjs[role][0];texObjs[role][0]=texObjs[role][1];texObjs[role][1]=tmp;
 const media=texMedia[role][0];texMedia[role][0]=texMedia[role][1];texMedia[role][1]=media;
 bindTextureSlot(role,0);bindTextureSlot(role,1);
}
function refreshVideoTextures(){
 for(let role=0;role<2;role++)for(let slot=0;slot<2;slot++){
   const video=texMedia[role][slot];
   if(!(video instanceof HTMLVideoElement)||video.readyState<HTMLMediaElement.HAVE_CURRENT_DATA||!video.videoWidth)continue;
   bindTextureSlot(role,slot);
   gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,video);
 }
}
async function requestImageChange(a,idx){
 const s=seqStates[a];
 if(panicActive||s.loading||s.transitioning||idx===s.current||!imageConfigs[a].images[idx].enabled)return;
 s.loading=true;
 await uploadMediaToSlot(1,1,a,idx);
 if(panicActive){s.loading=false;return}
 s.next=idx;s.blend=0;s.transStart=performance.now();s.transitioning=true;s.loading=false;
}
function updateImageSequence(now,Eff,freezeAdvances=false){
 const a=target,s=seqStates[a],cfg=imageConfigs[a];
 if(s.transitioning){
   const dur=Math.max(.2,cfg.crossfade||2.2)*1000;
   s.blend=Math.min(1,(now-s.transStart)/dur);
   if(s.blend>=1){
     swapTextureSlots(1);s.current=s.next;s.blend=0;s.transitioning=false;s.lastSwitch=now;
     if(document.getElementById('imagePanel').classList.contains('open'))renderImageManager();
   }
   return;
 }
 if(freezeAdvances)return;
 const enabled=enabledImages(a);if(enabled.length<2)return;
 if(cfg.mode==='auto'){
   const dwell=Math.max(2,cfg.images[s.current].duration||10)*1000;
   if(now-s.lastSwitch>=dwell)requestImageChange(a,nextEnabled(a,s.current,1));
 }else if(cfg.mode==='mapped'){
   const v=clamp(mappedSourceValue(cfg.source,Eff),0,1);
   const minDwell=Math.max(1.0,Math.min(8,cfg.images[s.current].duration||3))*1000;
   if(mappedSourceIsEvent(cfg.source)){
     const th=cfg.threshold||.55;
     // Rising-edge trigger: each detected Beat/Kick/Snare event advances one image in the chosen order.
     if(v>=th && s.lastMappedSignal<th && now-s.lastSwitch>=minDwell)requestImageChange(a,nextEnabled(a,s.current,1));
     s.lastMappedSignal=v;
   }else{
     // Continuous musical state: low values use early images, high values later images.
     const desired=enabled[Math.min(enabled.length-1,Math.floor(v*enabled.length))];
     if(desired!==s.current&&now-s.lastSwitch>=minDwell)requestImageChange(a,desired);
     s.lastMappedSignal=v;
   }
 }
}
async function loadArchetypeIntoRole(role,a){
 const s=seqStates[a],e=enabledImages(a),i0=e.includes(s.current)?s.current:(e[0]??0),i1=s.transitioning?s.next:i0;
 s.current=i0;s.next=i1;
 await Promise.all([uploadMediaToSlot(role,0,a,i0),uploadMediaToSlot(role,1,a,i1)]);
}
const remoteRoleSignatures=['',''],remoteRoleTokens=[0,0];
function syncRemoteRole(role,a,state){
 if(!state||!IMAGE_SETS[a])return;
 const i0=Math.max(0,Math.min(IMAGE_SETS[a].length-1,state.current||0));
 const i1=Math.max(0,Math.min(IMAGE_SETS[a].length-1,state.next??i0));
 const signature=`${a}:${i0}:${i1}`;
 if(remoteRoleSignatures[role]===signature)return;
 remoteRoleSignatures[role]=signature;const token=++remoteRoleTokens[role];
 Promise.all([uploadMediaToSlot(role,0,a,i0),uploadMediaToSlot(role,1,a,i1)]).then(()=>{
   if(token!==remoteRoleTokens[role])return;
   const seq=seqStates[a];seq.current=i0;seq.next=i1;
 }).catch(error=>console.error('Unable to synchronize show media',error));
}
function applyRemoteVisualState(state){
 if(!state||!archetypes[state.current]||!archetypes[state.target])return;
 setBlackout(!!state.blackout);
 FinalG={...NEUTRAL_TARGETS,...state.finalG};
 current=state.current;target=state.target;archMix=Number.isFinite(state.archMix)?state.archMix:1;transitioning=!!state.transitioning;
 syncRemoteRole(0,current,state.seqA);syncRemoteRole(1,target,state.seqB);
 if(state.seqA&&seqStates[current])Object.assign(seqStates[current],{current:state.seqA.current,next:state.seqA.next,blend:state.seqA.blend||0,transitioning:!!state.seqA.transitioning});
 if(state.seqB&&seqStates[target])Object.assign(seqStates[target],{current:state.seqB.current,next:state.seqB.next,blend:state.seqB.blend||0,transitioning:!!state.seqB.transitioning});
}
function sequenceSnapshot(a){const s=seqStates[a];return {current:s.current,next:s.next,blend:s.blend,transitioning:s.transitioning}}
function broadcastShowFrame(now,Eff){
 if(!showChannel||now-lastShowBroadcastAt<40)return;
 lastShowBroadcastAt=now;
 showChannel.postMessage({type:'frame',state:{finalG:{...FinalG},eff:{...Eff},current,target,archMix,transitioning,blackout:blackoutActive,seqA:sequenceSnapshot(current),seqB:sequenceSnapshot(target),bpm:BPM,beat:BeatPulse,kick:KickFast,snare:SnareFast}});
}
Promise.all([loadArchetypeIntoRole(0,0),loadArchetypeIntoRole(1,0)]).then(()=>start());

let audioCtx=null,analyser=null,source=null,F=null,T=null,audioObjectUrl=null;
const audio=document.getElementById('audio');
const playButton=document.getElementById('play');
const seekControl=document.getElementById('seek');
const volumeControl=document.getElementById('volume');
const muteButton=document.getElementById('mute');
const trackName=document.getElementById('trackName');
const timeDisplay=document.getElementById('timeDisplay');
let seeking=false;

function formatTime(seconds){
 if(!Number.isFinite(seconds)||seconds<0)return '0:00';
 const minutes=Math.floor(seconds/60),rest=Math.floor(seconds%60);
 return minutes+':'+String(rest).padStart(2,'0');
}
function updateTimeDisplay(previewTime=audio.currentTime){
 timeDisplay.textContent=formatTime(previewTime)+' / '+formatTime(audio.duration);
}
function updateTransportState(){
 const isPaused=audio.paused;
 playButton.textContent=isPaused?'▶':'Ⅱ';
 playButton.title=isPaused?'Play':'Pause';
 playButton.setAttribute('aria-label',isPaused?'Play':'Pause');
 muteButton.textContent=audio.muted?'🔇':'🔊';
 muteButton.title=audio.muted?'Unmute':'Mute';
 muteButton.setAttribute('aria-label',audio.muted?'Unmute':'Mute');
 muteButton.classList.toggle('active',audio.muted);
}
let Raw={energy:0,density:0,drive:0,boombap:0,tension:0,bright:0,open:.6};
let Fast={energy:0,density:0,drive:0,boombap:0,tension:0,bright:0,open:.6};
let Context={energy:0,density:0,drive:0,boombap:0,tension:0,bright:0,open:.6};
let S={energy:0,density:0,drive:0,boombap:0,tension:0,bright:0,open:.6};
let prevEnergy=0,driveMem=0,lastAnalysisAt=0, prevLow=0, prevSnare=0, boomMem=0, KickFast=0, SnareFast=0;
let BPM=0, BPMConfidence=0, beatAnchorSec=null, BeatPulse=0, lastBpmEstimateAt=0;
const beatHistory=[];
const history=[];
async function ensureAudio(){
 if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)();
 if(audioCtx.state==='suspended') await audioCtx.resume();
}
document.getElementById('file').onchange=async e=>{
 const f=e.target.files[0]; if(!f)return;
 if(audioObjectUrl)URL.revokeObjectURL(audioObjectUrl);
 audioObjectUrl=URL.createObjectURL(f);audio.src=audioObjectUrl;
 trackName.textContent=f.name.replace(/\.[^.]+$/,'');
 playButton.disabled=false;muteButton.disabled=false;volumeControl.disabled=false;
 await ensureAudio();
 if(!source){
   source=audioCtx.createMediaElementSource(audio);
   analyser=audioCtx.createAnalyser();analyser.fftSize=1024;analyser.smoothingTimeConstant=.56;
   source.connect(analyser);analyser.connect(audioCtx.destination);
   F=new Uint8Array(analyser.frequencyBinCount);T=new Uint8Array(analyser.fftSize);
 }
 await audio.play();
};
playButton.onclick=async()=>{await ensureAudio();audio.paused?audio.play():audio.pause()};
audio.addEventListener('loadedmetadata',()=>{seekControl.disabled=false;seekControl.value='0';updateTimeDisplay(0)});
audio.addEventListener('timeupdate',()=>{
 if(!seeking&&Number.isFinite(audio.duration)&&audio.duration>0)seekControl.value=String(Math.round(audio.currentTime/audio.duration*1000));
 if(!seeking)updateTimeDisplay();
});
audio.addEventListener('play',updateTransportState);
audio.addEventListener('pause',updateTransportState);
audio.addEventListener('ended',updateTransportState);
seekControl.addEventListener('input',()=>{seeking=true;const preview=Number.isFinite(audio.duration)?(+seekControl.value/1000)*audio.duration:0;updateTimeDisplay(preview)});
seekControl.addEventListener('change',()=>{if(Number.isFinite(audio.duration))audio.currentTime=(+seekControl.value/1000)*audio.duration;seeking=false;updateTimeDisplay()});
volumeControl.addEventListener('input',()=>{audio.volume=+volumeControl.value;if(audio.volume>0&&audio.muted)audio.muted=false;updateTransportState()});
muteButton.onclick=()=>{audio.muted=!audio.muted;updateTransportState()};
document.getElementById('fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
document.getElementById('diagBtn').onclick=()=>{const d=document.getElementById('diag');d.style.display=d.style.display==='none'?'block':'none'};
const shortcutDialog=document.getElementById('shortcutDialog'),shortcutToast=document.getElementById('shortcutToast');
let shortcutToastTimer=0;
function showShortcutToast(message){
 shortcutToast.textContent=message;shortcutToast.classList.add('show');clearTimeout(shortcutToastTimer);
 shortcutToastTimer=setTimeout(()=>shortcutToast.classList.remove('show'),1100);
}
function openShortcutGuide(){if(!shortcutDialog.open)shortcutDialog.showModal()}
document.getElementById('shortcutHelpBtn').onclick=openShortcutGuide;
document.getElementById('closeShortcutDialog').onclick=()=>shortcutDialog.close();
const blackoutOverlay=document.getElementById('blackoutOverlay'),blackoutButton=document.getElementById('blackoutBtn'),panicButton=document.getElementById('panicBtn');
function updateSafetyUi(){
 blackoutOverlay.classList.toggle('active',blackoutActive);blackoutButton.classList.toggle('active',blackoutActive);blackoutButton.setAttribute('aria-pressed',String(blackoutActive));
 panicButton.classList.toggle('active',panicActive);panicButton.setAttribute('aria-pressed',String(panicActive));
 document.getElementById('blackoutStatus').classList.toggle('active',blackoutActive);document.getElementById('panicStatus').classList.toggle('active',panicActive);
}
function setBlackout(value){blackoutActive=!!value;updateSafetyUi();return blackoutActive}
function toggleBlackout(){return setBlackout(!blackoutActive)}
function setPanic(value){
 const next=!!value;if(next===panicActive)return panicActive;
 panicActive=next;
 if(panicActive){panicReleaseStartedAt=null;current=target;archMix=1;transitioning=false}
 else{panicReleaseStartedAt=performance.now();if(seqStates[target])seqStates[target].lastSwitch=performance.now()}
 updateSafetyUi();return panicActive;
}
function togglePanic(){return setPanic(!panicActive)}
blackoutButton.onclick=toggleBlackout;panicButton.onclick=togglePanic;
window.EyesForBeatsSafety={toggleBlackout,togglePanic,setBlackout,setPanic};
updateSafetyUi();
const showModeButton=document.getElementById('showModeBtn');
if(!showChannel){showModeButton.disabled=true;showModeButton.title='Show mode is not supported by this browser';if(isShowMode)document.getElementById('showConnection').textContent='BROADCAST CHANNEL NOT SUPPORTED'}
showModeButton.onclick=()=>{
 const url=new URL(location.href);url.searchParams.set('show','1');
 if(showWindow&&!showWindow.closed){showWindow.focus();return}
 showWindow=window.open(url,'eyesforbeats-show','popup,width=1280,height=720');
 if(!showWindow){showModeButton.title='Allow pop-ups to open the show output';return}
 showModeButton.title='Show output opened · move it to the projector and double-click for full screen';
};
setInterval(()=>{
 const connected=Date.now()-lastShowPeerAt<4500;
 showModeButton.classList.toggle('connected',connected);
 showModeButton.title=connected?'Show output connected':'Open show output';
},1000);

function analyze(now){
 if(!analyser)return;
 // Rhythm analysis runs at ~25 Hz for tighter kick/snare and beat timing.
 if(now-lastAnalysisAt<40)return;
 lastAnalysisAt=now;

 analyser.getByteFrequencyData(F); analyser.getByteTimeDomainData(T);
 let low=0,mid=0,high=0,all=0,n=F.length;
 for(let i=0;i<n;i++){
   let v=F[i]/255; all+=v;
   if(i<n*.10)low+=v;
   else if(i<n*.38)mid+=v;
   else high+=v;
 }
 low/=n*.10; mid/=n*.28; high/=n*.62; all/=n;

 let rms=0;
 for(let i=0;i<T.length;i++){let x=(T[i]-128)/128;rms+=x*x}
 rms=Math.sqrt(rms/T.length);

 // Raw instantaneous layer: useful only as micro-detail.
 let energy=Math.min(1,rms*4.0);
 let flux=Math.max(0,energy-prevEnergy); prevEnergy=energy;
 driveMem=driveMem*.84+Math.min(1,flux*5.0+low*.48)*.16;
 let density=Math.min(1,all*1.18+mid*.30);
 let bright=Math.min(1,(high*1.55)/(low+.20));

 // BoomBap estimates kick/snare emphasis:
 // - kick side: low band transient + low band presence
 // - snare side: low-mid / mid transient + brightness presence
 let lowFlux=Math.max(0,low-prevLow); prevLow=low;
 let snareBand=Math.max(0,(mid*1.08 + high*0.35) - low*0.25);
 let snareFlux=Math.max(0,snareBand-prevSnare); prevSnare=snareBand;
 let kickHit=Math.min(1, lowFlux*4.4 + low*0.50);
 let snareHit=Math.min(1, snareFlux*4.8 + snareBand*0.28);

 // Short hit envelopes for actual visual accents.
 KickFast = KickFast*0.52 + kickHit*0.48;
 SnareFast = SnareFast*0.50 + snareHit*0.50;

 // Onset envelope used by the BPM/beat-clock estimator.
 let onsetStrength=Math.min(1, lowFlux*2.7 + snareFlux*2.8 + flux*1.35);
 const nowSec=now/1000;
 beatHistory.push({t:nowSec,o:onsetStrength,k:kickHit,s:snareHit});
 while(beatHistory.length && beatHistory[0].t<nowSec-12) beatHistory.shift();

 // Lightweight autocorrelation BPM estimator, recalculated about once per second.
 // Candidate tempo range: 65–155 BPM.
 if(now-lastBpmEstimateAt>900 && beatHistory.length>110){
   lastBpmEstimateAt=now;
   const vals=beatHistory.map(x=>x.o);
   const mean=vals.reduce((a,b)=>a+b,0)/vals.length;
   const centered=vals.map(v=>v-mean);
   let energyNorm=centered.reduce((a,v)=>a+v*v,0)+1e-6;
   let bestBpm=BPM||92, bestScore=-1;
   const sampleDt=Math.max(.035,Math.min(.055,(beatHistory[beatHistory.length-1].t-beatHistory[0].t)/Math.max(1,beatHistory.length-1)));

   function corrForLag(lag){
     let num=0,a2=0,b2=0;
     for(let i=lag;i<centered.length;i++){
       const a=centered[i], b=centered[i-lag];
       num+=a*b; a2+=a*a; b2+=b*b;
     }
     return num/(Math.sqrt(a2*b2)+1e-6);
   }

   for(let bpm=65;bpm<=155;bpm+=1){
     const lag=Math.max(2,Math.round((60/bpm)/sampleDt));
     if(lag*2>=centered.length) continue;
     const c1=corrForLag(lag);
     const c2=corrForLag(lag*2);
     const halfLag=Math.max(2,Math.round(lag/2));
     const ch=corrForLag(halfLag);
     let score=c1*.68+c2*.24+ch*.08;
     if(BPM>0) score-=Math.min(.10,Math.abs(bpm-BPM)*.0018);
     if(score>bestScore){bestScore=score;bestBpm=bpm;}
   }

   const conf=Math.max(0,Math.min(1,(bestScore-.04)/.42));
   BPMConfidence=BPMConfidence*.72+conf*.28;
   if(conf>.10){
     if(BPM===0) BPM=bestBpm;
     else BPM=BPM*.78+bestBpm*.22;
   }
 }

 // Establish/snap the beat grid to strong percussive onsets.
 if(BPM>0){
   const period=60/BPM;
   const strongHit=Math.max(kickHit,snareHit,onsetStrength);
   if(beatAnchorSec===null && strongHit>.52){
     beatAnchorSec=nowSec;
   } else if(beatAnchorSec!==null && strongHit>.58){
     const nBeat=Math.round((nowSec-beatAnchorSec)/period);
     const predicted=beatAnchorSec+nBeat*period;
     const err=nowSec-predicted;
     if(Math.abs(err)<period*.22) beatAnchorSec+=err*.20;
   }
 }

 // BOOMBAP is now groove strength, not BPM itself:
 // regular beat confidence + current kick/snare activity + drive.
 let percussivePresence=Math.min(1,(kickHit+snareHit)*.55);
 let boombapInstant=Math.min(1,BPMConfidence*.58 + percussivePresence*.30 + driveMem*.12);
 boomMem=boomMem*.76 + boombapInstant*.24;

 let tension=Math.min(1,bright*.22+flux*1.55+Math.max(0,mid-low*.65)*.26);
 let openness=Math.max(0,Math.min(1,.80-density*.42-tension*.14+bright*.08));

 Raw={energy,density,drive:driveMem,boombap:boomMem,tension,bright,open:openness};

 const lerp=(a,b,k)=>a+(b-a)*k;

 // FAST LAYER: ~0.3–1.0 s. It can add accents, but cannot drive the world.
 Fast.energy=lerp(Fast.energy,Raw.energy,.30);
 Fast.density=lerp(Fast.density,Raw.density,.22);
 Fast.drive=lerp(Fast.drive,Raw.drive,.26);
 Fast.boombap=lerp(Fast.boombap,Raw.boombap,.30);
 Fast.bright=lerp(Fast.bright,Raw.bright,.18);
 Fast.tension=lerp(Fast.tension,Raw.tension,.13);
 Fast.open=lerp(Fast.open,Raw.open,.10);

 // Keep a 20-second rolling history.
 history.push({t:now/1000,...Raw});
 const oldest=now/1000-20;
 while(history.length && history[0].t<oldest) history.shift();

 function rolling(key,seconds,fallback){
   const cutoff=now/1000-seconds;
   let sum=0,count=0;
   for(let i=history.length-1;i>=0;i--){
     const s=history[i];
     if(s.t<cutoff)break;
     sum+=s[key];count++;
   }
   return count ? sum/count : fallback;
 }

 // CONTEXT LAYER: deliberately different windows for different perceptions.
 // Energy 3s, Density 6s, Drive 4s, BoomBap 4s, Brightness 6s,
 // Tension 12s, Openness 15s.
 const targetContext={
   energy:rolling('energy',3,Fast.energy),
   density:rolling('density',6,Fast.density),
   drive:rolling('drive',4,Fast.drive),
   boombap:rolling('boombap',4,Fast.boombap),
   bright:rolling('bright',6,Fast.bright),
   tension:rolling('tension',12,Fast.tension),
   open:rolling('open',15,Fast.open)
 };

 // Extra inertia stops contextual meters from wobbling as the window changes.
 Context.energy=lerp(Context.energy,targetContext.energy,.18);
 Context.density=lerp(Context.density,targetContext.density,.12);
 Context.drive=lerp(Context.drive,targetContext.drive,.15);
 Context.boombap=lerp(Context.boombap,targetContext.boombap,.16);
 Context.bright=lerp(Context.bright,targetContext.bright,.10);
 Context.tension=lerp(Context.tension,targetContext.tension,.065);
 Context.open=lerp(Context.open,targetContext.open,.05);

 // Global slider: 0 = performance / immediate layer, 1 = context / phrase layer.
 // Small per-variable shaping keeps the personality of each dimension while still allowing pure performance mode.
 const mix=+document.getElementById('ctxPerf').value;
 function blend(f,c,shape){
   const w=Math.max(0,Math.min(1,mix*shape));
   return f*(1-w)+c*w;
 }
 S.energy=blend(Fast.energy,Context.energy,0.95);
 S.density=blend(Fast.density,Context.density,1.00);
 S.drive=blend(Fast.drive,Context.drive,0.92);
 // Rhythm is intentionally much more performance-led than the other states.
 const bbContextWeight=Math.min(.20,(+document.getElementById('ctxPerf').value)*.20);
 S.boombap=Fast.boombap*(1-bbContextWeight)+Context.boombap*bbContextWeight;
 S.bright=blend(Fast.bright,Context.bright,1.00);
 S.tension=blend(Fast.tension,Context.tension,1.08);
 S.open=blend(Fast.open,Context.open,1.12);
}

let current=0,target=0,archMix=0,transitioning=false,mode='smooth',transitionStart=0;
let archetypeSelectionBusy=false,queuedArchetype=null;
renderPresetControls();
function renderArchetypeBar(){
 const bar=document.getElementById('archBar');bar.innerHTML='';
 archetypes.forEach((arch,index)=>{
   const button=document.createElement('button');button.className='arch'+(index===target?' active':'');button.dataset.a=String(index);
   const profile=visualProfileIndex(index),subtitle=arch.customId?'custom · '+archetypes[profile].name.toLowerCase():(['space / contemplation','groove / elastic flow','growth / breath / living systems','pressure / momentum','heart / visceral energy','living heart / neon anatomy'][index]||'visual archetype');
   button.innerHTML='<b>'+(index+1)+' · '+arch.name+'</b><span>'+subtitle+'</span>';button.onclick=()=>selectArchetype(index);bar.appendChild(button);
 });
 const createButton=document.createElement('button');createButton.id='archetypeCreatorBtn';createButton.className='createArchFooter';createButton.title='Create a new archetype';createButton.setAttribute('aria-label','Create archetype');createButton.innerHTML='<b>＋ CREATE ARCHETYPE</b><span>add your image sequence</span>';createButton.onclick=openArchetypeCreator;bar.appendChild(createButton);
}
async function selectArchetype(a){
 if(!Number.isInteger(a)||a<0||a>=archetypes.length)return;
 if(a===target)return;
 if(archetypeSelectionBusy){queuedArchetype=a;return}
 archetypeSelectionBusy=true;
 const previous=target;
 try{
   await Promise.all([loadArchetypeIntoRole(0,previous),loadArchetypeIntoRole(1,a)]);
   current=previous;target=a;
   document.querySelectorAll('.arch').forEach(x=>x.classList.toggle('active',+x.dataset.a===a));
   if(mode==='cut'||panicActive){current=target;archMix=1;transitioning=false}
   else{transitioning=true;archMix=0;transitionStart=performance.now()}
   renderPresetControls();
   if(document.getElementById('matrixPanel').classList.contains('open'))renderMatrixEditor();
   if(document.getElementById('imagePanel').classList.contains('open'))renderImageManager();
 }finally{
   archetypeSelectionBusy=false;
   const queued=queuedArchetype;queuedArchetype=null;
   if(queued!=null&&queued!==target)selectArchetype(queued);
 }
}
renderArchetypeBar();
const archBarToggle=document.getElementById('archBarToggle'),uiRoot=document.querySelector('.ui'),archBar=document.getElementById('archBar');
function updateFooterMetrics(){uiRoot.style.setProperty('--footer-height',`${Math.ceil(archBar.getBoundingClientRect().height)}px`)}
new ResizeObserver(updateFooterMetrics).observe(archBar);updateFooterMetrics();
function setArchetypeBarCollapsed(collapsed){
 uiRoot.classList.toggle('footerCollapsed',collapsed);
 archBarToggle.setAttribute('aria-expanded',String(!collapsed));
 archBarToggle.textContent=collapsed?'⌃ ARCHETYPES':'⌄ HIDE ARCHETYPES';
 try{localStorage.setItem('eyesforbeats_footer_collapsed',collapsed?'1':'0')}catch(e){}
}
let footerStartsCollapsed=false;
try{footerStartsCollapsed=localStorage.getItem('eyesforbeats_footer_collapsed')==='1'}catch(e){}
setArchetypeBarCollapsed(footerStartsCollapsed);
archBarToggle.onclick=()=>setArchetypeBarCollapsed(!uiRoot.classList.contains('footerCollapsed'));
const smoothButton=document.getElementById('smooth'),cutButton=document.getElementById('cut');
function setTransitionMode(next){mode=next;smoothButton.classList.toggle('active',mode==='smooth');cutButton.classList.toggle('active',mode==='cut')}
smoothButton.onclick=()=>setTransitionMode('smooth');
cutButton.onclick=()=>setTransitionMode('cut');
function shortcutTypingContext(element){return !!document.querySelector('dialog[open]')||element?.matches?.('input,textarea,select,[contenteditable="true"]')||!!element?.closest?.('[contenteditable="true"]')}
document.addEventListener('keydown',event=>{
 if(isShowMode||event.repeat||shortcutTypingContext(event.target))return;
 const action=resolvePerformanceShortcut(event,archetypes.length);if(!action)return;
 event.preventDefault();
 if(action.type==='help'){openShortcutGuide();return}
 if(action.type==='safety'){
   const active=action.control==='blackout'?toggleBlackout():togglePanic();
   showShortcutToast(action.control.toUpperCase()+' · '+(active?'ON':'OFF'));return;
 }
 if(action.type==='transition'){setTransitionMode(action.mode);showShortcutToast(action.mode.toUpperCase()+' TRANSITIONS');return}
 if(action.type==='preset-select'){activatePreset(action.index);return}
 if(action.type==='preset-step'){stepPreset(action.direction);return}
 const index=action.type==='step'?(target+action.direction+archetypes.length)%archetypes.length:action.index;
 showShortcutToast(String(index+1).padStart(2,'0')+' · '+archetypes[index].name+' — '+mode.toUpperCase());selectArchetype(index);
});

let particles=[];
function resize(){
 const scale=.78;
 let w=Math.floor(innerWidth*scale),h=Math.floor(innerHeight*scale);
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h)}
 if(pcanvas.width!==innerWidth||pcanvas.height!==innerHeight){pcanvas.width=innerWidth;pcanvas.height=innerHeight}
}
function updateParticles(t){
 const a=archetypes[target].behavior;
 const profile=visualProfileIndex(target);
 const partAmt=FinalG.parts;
 const wanted=Math.floor(150*a.particle*partAmt);
 while(particles.length<wanted) particles.push({x:Math.random()*innerWidth,y:Math.random()*innerHeight,z:Math.random(),r:.6+Math.random()*2.3,vx:(Math.random()-.5),vy:(Math.random()-.5),life:Math.random()*100});
 while(particles.length>wanted)particles.pop();
 ctx.clearRect(0,0,pcanvas.width,pcanvas.height);
 ctx.globalCompositeOperation='screen';
 let speed=.12+a.particle*.22+partAmt*.42;
 for(const p of particles){
   if(profile===1){p.x+=(1.2*speed)*(1+p.z);p.y+=Math.sin((p.x+p.life)*.01)*.16}
   else if(profile===2){let dx=p.x-innerWidth/2,dy=p.y-innerHeight/2,dl=Math.hypot(dx,dy)||1;p.x+=dx/dl*.16*speed;p.y+=dy/dl*.16*speed}
   else if(profile===3){p.x+=2.2*speed;p.y+=(Math.random()-.5)*.22*speed}
   else if(profile===4){let dx=p.x-innerWidth/2,dy=p.y-innerHeight/2,dl=Math.hypot(dx,dy)||1;p.x+=dx/dl*.12*speed;p.y+=dy/dl*.12*speed}
   else if(profile===5){p.x+=(p.z+.35)*1.5*speed;p.y+=Math.sin(t*.001+p.life)*.08*speed}
   else{p.x+=Math.sin(t*.0002+p.life)*.12*speed;p.y-=.12*speed*(.5+p.z)}
   if(p.x<-10)p.x=innerWidth+10;if(p.x>innerWidth+10)p.x=-10;if(p.y<-10)p.y=innerHeight+10;if(p.y>innerHeight+10)p.y=-10;
   let alpha=(.08+.34*p.z)*clamp(partAmt,0,1.4);
   ctx.fillStyle=`rgba(190,235,255,${alpha})`;
   ctx.strokeStyle=`rgba(190,235,255,${alpha})`;
   ctx.lineWidth=.6+p.z;
   if(profile===1||profile===3||profile===5){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-(8+18*p.z)*speed,p.y+(profile===5?3:0));ctx.stroke()}
   else if(profile===2){ctx.beginPath();ctx.arc(p.x,p.y,p.r*(1.5+p.z*2),0,Math.PI*2);ctx.stroke()}
   else{ctx.beginPath();ctx.arc(p.x,p.y,p.r*(.6+p.z),0,Math.PI*2);ctx.fill()}
 }
 ctx.globalCompositeOperation='source-over';
}
function smoothstep(x){return x*x*(3-2*x)}

let t0=performance.now(),last=performance.now();
function start(){requestAnimationFrame(frame)}
function frame(now){
 resize();
 const dt=Math.min(.05,(now-last)/1000);last=now;
 let Eff;
 if(isShowMode){
   if(remoteVisualState){applyRemoteVisualState(remoteVisualState);BPM=remoteVisualState.bpm||0;BeatPulse=remoteVisualState.beat||0;KickFast=remoteVisualState.kick||0;SnareFast=remoteVisualState.snare||0}
   Eff=remoteVisualState?.eff||neutralVals;
 }else{
   analyze(now);
   // Tempo-synced pulse is calculated every visual frame from the current beat clock.
   let beatPhase=0;
   if(BPM>0 && beatAnchorSec!==null){
     const period=60/BPM;
     const pos=(now/1000-beatAnchorSec)/period;
     beatPhase=((pos%1)+1)%1;
     BeatPulse=Math.exp(-beatPhase*8.5)*BPMConfidence;
   } else BeatPulse*=0.92;
   Eff=getEffectiveState();
   const routedTargets=computeGlobalMapping(Eff,now);
   FinalG=applyPanicTargets(routedTargets,{panic:panicActive,releaseStartedAt:panicReleaseStartedAt,now,duration:300});
   if(panicReleaseStartedAt!=null&&now-panicReleaseStartedAt>=300)panicReleaseStartedAt=null;
   routeTargets.forEach(key=>{document.getElementById('gf-'+key).textContent=FinalG[key].toFixed(2)});
   updateImageSequence(now,Eff,panicActive);
   if(transitioning){
     let x=Math.min(1,(now-transitionStart)/6500);archMix=smoothstep(x);
     if(x>=1){current=target;archMix=1;transitioning=false}
   }
   broadcastShowFrame(now,Eff);
 }
 gl.useProgram(prog);
 gl.uniform2f(U.uRes,canvas.width,canvas.height);
 gl.uniform1f(U.uTime,(now-t0)/1000);
 gl.uniform1f(U.uMorphA,seqStates[current].blend);gl.uniform1f(U.uMorphB,seqStates[target].blend);
 gl.uniform1f(U.uArchMix,transitioning?archMix:1);
 gl.uniform1i(U.uArchA,visualProfileIndex(current));
 gl.uniform1i(U.uArchB,visualProfileIndex(target));
 gl.uniform1f(U.uMapPulse,FinalG.pulse);
 gl.uniform1f(U.uDistAmt,FinalG.dist);gl.uniform1f(U.uGlowAmt,FinalG.glow);gl.uniform1f(U.uLumAmt,FinalG.luma);gl.uniform1f(U.uSatAmt,FinalG.sat);gl.uniform1f(U.uZoomAmt,FinalG.zoom);
 refreshVideoTextures();
 gl.drawArrays(gl.TRIANGLES,0,3);
 updateParticles(now);
 const vals=[['E',Eff.energy],['D',Eff.density],['R',Eff.drive],['K',Eff.boombap],['T',Eff.tension],['B',Eff.bright],['O',Eff.open]];
 vals.forEach(([k,v])=>{document.getElementById('v'+k).textContent=v.toFixed(2);document.getElementById('f'+k).style.width=(v*100)+'%'});
 document.getElementById('vBeat').textContent=BeatPulse.toFixed(2);
 document.getElementById('fBeat').style.width=(Math.min(1,BeatPulse)*100)+'%';
 document.getElementById('vBPM').textContent=BPM>0?Math.round(BPM):'--';
 document.getElementById('fBpmConf').style.width=(BPMConfidence*100)+'%';
 document.getElementById('microState').textContent=
   'Beat '+BeatPulse.toFixed(2)+' · Kick '+KickFast.toFixed(2)+' · Snare '+SnareFast.toFixed(2)+' · '+archetypes[target].name+' IMG '+(seqStates[target].current+1)+' ['+imageConfigs[target].mode.toUpperCase()+'] · Zoom '+FinalG.zoom.toFixed(2)+' · '+(BPM>0?Math.round(BPM)+' BPM':'learning');
 requestAnimationFrame(frame);
}
