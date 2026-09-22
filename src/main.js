import './styles.css';
import { routeSources, routeTargets, sourceLabels, targetLabels, blankMap } from './config.js';
import { computeTargetState, NEUTRAL_TARGETS, resolveTargetActivity } from './routing.js';
import { vertexShaderSource, fragmentShaderSource } from './shaders.js';
import { collectLegacyLibrary, legacyDataAvailable } from './legacy/export.js';
import { SyncedLibraryRepository } from './library/synced-repository.js';
import { LocalLibraryRepository } from './library/local-repository.js';
import { buildProjectRuntime, defaultImageConfig, normalizeRoutingMap, resolveShowIndexes, starterRoutingForOrigin } from './library/runtime.js';
import { resolvePerformanceShortcut } from './shortcuts.js';
import { applyPanicTargets } from './show-safety.js';
import { AudioInputController, INPUT_DEVICE_KEY, readableInputError } from './audio-input.js';
import { icon, initIcons } from './icons.js';
import { buildLibraryPackage, readPackage, verifyLibraryPackage } from './package-format.js';
import { prepareImportedArchetype } from './library/package-mapping.js';
import { FACTORY_LOOKS, LOOK_FIELDS, NEUTRAL_LOOK, hexRgb, lookUniforms, normalizeLook, particleSpeed, stepParticle } from './looks.js';
import packageInfo from '../package.json';
import { EASINGS, TRANSITIONS, WIPE_DIRECTIONS, resolveTransitionParam, transitionShaderId } from './transitions.js';
import { DWELL_BEAT_OPTIONS, IMAGE_TRIGGER_CLASSES, TRANSITION_BEAT_OPTIONS, applyTransitionEasing, beatsToSeconds, classifyImageTrigger, effectiveBeatDwell, effectiveTransitionDuration, nextSequenceIndex, pickTransitionFromPool, quantizeToBeatGrid, resolvePendingImageRequest, resolveSequencerTempo, transitionRunsAsCut } from './image-sequencer.js';

const isShowMode=new URLSearchParams(location.search).get('show')==='1';
document.body.classList.toggle('showMode',isShowMode);
initIcons();
function ensureButtonTooltip(button){
 if(button.title||button.dataset.tooltip)return;
 const text=button.textContent.trim().replace(/\s+/g,' ');
 const label=button.getAttribute('aria-label')||(button.dataset.solo?`Solo ${button.dataset.solo}`:text);
 if(label)button.title=label;
}
function applyButtonTooltips(root=document){if(root.matches?.('button'))ensureButtonTooltip(root);root.querySelectorAll?.('button').forEach(ensureButtonTooltip)}
applyButtonTooltips();
new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)applyButtonTooltips(node)}))).observe(document.body,{childList:true,subtree:true});
const showChannel='BroadcastChannel' in window?new BroadcastChannel('eyesforbeats-show-v1'):null;
let remoteVisualState=null,lastShowPeerAt=0,showWindow=null,lastShowBroadcastAt=0,remoteSwitchPromise=null;
let blackoutActive=false,panicActive=false,panicReleaseStartedAt=null;
if(isShowMode){
 const status=document.createElement('div');status.id='showConnection';status.className='showConnection';status.textContent='WAITING FOR CONTROLLER';document.body.appendChild(status);
 const announce=()=>showChannel?.postMessage({type:'show-ready'});announce();setInterval(announce,2000);
 document.addEventListener('dblclick',()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{})});
 document.addEventListener('keydown',event=>{if(event.key.toLowerCase()==='f'&&!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{})});
}
showChannel?.addEventListener('message',event=>{
 const message=event.data||{};
 if(isShowMode&&message.type==='frame'){
   remoteVisualState=message.state;document.getElementById('showConnection')?.classList.add('connected');
   if(message.state?.projectId!==activeProject?.id&&!remoteSwitchPromise){
     remoteSwitchPromise=openProject(message.state.projectId,{fromShow:true}).catch(error=>console.error('Unable to switch Show project',error)).finally(()=>{remoteSwitchPromise=null});
   }
 }
 if(isShowMode&&message.type==='transition-start')startRemoteImageTransition(message.transition,0);
 if(isShowMode&&message.type==='library-changed'&&!remoteSwitchPromise){
   remoteSwitchPromise=openProject(message.projectId||activeProject?.id,{fromShow:true}).catch(error=>console.error('Unable to reload Show library',error)).finally(()=>{remoteSwitchPromise=null});
 }
 if(!isShowMode&&message.type==='show-ready')lastShowPeerAt=Date.now();
});

let libraryVersionChanged=false,syncReloadTimer=null,lastConflictKey=null,remoteRefreshPending=false;
function renderSyncState(state){
 const status=document.getElementById('syncStatus');if(!status)return;
 document.getElementById('accountEmail').textContent=state.email||'Offline cache';status.textContent=state.status.toUpperCase().replace('-',' ');
 document.getElementById('syncLast').textContent='Last sync: '+(state.lastSync?new Date(state.lastSync).toLocaleString():'never');
 if(state.status==='session-expired'){const notice=document.getElementById('libraryNotice');notice.textContent='Session expired — reload to sign in. Cached projects remain available.';notice.hidden=false}
 const lock=document.getElementById('liveLockBtn'),badge=document.getElementById('liveLockBadge');lock.setAttribute('aria-pressed',String(state.liveLock));badge.hidden=!state.liveLock;badge.querySelector('span').textContent=String(state.pending||0);
 if(state.conflict){lastConflictKey=state.conflict.key;const notice=document.getElementById('libraryNotice');notice.replaceChildren(document.createTextNode(`${state.conflict.name} was changed by ${state.conflict.updatedBy||'another user'}. `));notice.hidden=false;const button=document.createElement('button');button.textContent='RESTORE MY VERSION';button.onclick=()=>repository.restoreConflict(lastConflictKey).catch(console.error);notice.appendChild(button)}
}
function onSyncedLibraryChanged(change={}){
 if(change.userChanged){clearTimeout(syncReloadTimer);syncReloadTimer=setTimeout(()=>location.reload(),50);return}
 if(change.deferredApplied){remoteRefreshPending=true;return}
 if(projectSwitching)return;clearTimeout(syncReloadTimer);syncReloadTimer=setTimeout(async()=>{const projects=await repository.listProjects(),wanted=activeProject&&projects.some(item=>item.id===activeProject.id)?activeProject.id:projects[0]?.id||null;await openProject(wanted,{preferredId:archetypes[target]?.id})},250);
}
const repository=new SyncedLibraryRepository({ readOnly:isShowMode, onState:renderSyncState, onLibraryChanged:onSyncedLibraryChanged });
window.EyesForBeatsSync={sync:()=>repository.sync(),setLiveLock:value=>repository.setLiveLock(value),toggleLiveLock:()=>repository.setLiveLock(!repository.state.liveLock)};
let activeProject=null,projectLookPresets=[],idToIndex=new Map();
let projectSwitching=false,projectSwitchGeneration=0;
const archetypes=[],IMAGE_SETS=[],defaultRoutingMaps=[];
let looks=[];
const pendingWrites=new Map(),failedWrites=new Map();
let writeQueue=Promise.resolve();
function queueArchetypeWrite(index,changes){
 const id=archetypes[index]?.id;if(!id||isShowMode)return;
 const pending=pendingWrites.get(id)||{changes:{...failedWrites.get(id)},timer:null};failedWrites.delete(id);
 Object.assign(pending.changes,structuredClone(changes));clearTimeout(pending.timer);
 pending.timer=setTimeout(()=>{void flushArchetypeWrites().catch(error=>console.error('Unable to save archetype',error))},500);
 pendingWrites.set(id,pending);
}
async function flushArchetypeWrites(){
 const writes=new Map(failedWrites);failedWrites.clear();
 for(const [id,pending] of pendingWrites){clearTimeout(pending.timer);writes.set(id,{...(writes.get(id)||{}),...pending.changes})}
 pendingWrites.clear();
 const attempts=[];
 for(const [id,changes] of writes){
   const attempt=writeQueue.then(()=>repository.updateArchetype(id,changes));writeQueue=attempt.catch(()=>{});
   attempts.push(attempt.catch(error=>{failedWrites.set(id,{...changes,...(failedWrites.get(id)||{})});document.getElementById('saveFailure').hidden=false;throw error}));
 }
 try{await Promise.all(attempts);if(!failedWrites.size)document.getElementById('saveFailure').hidden=true}
 catch(error){document.getElementById('saveFailure').hidden=false;throw error}
}
document.getElementById('retrySave').onclick=()=>{void flushArchetypeWrites().catch(error=>console.error('Retry save failed',error))};
window.addEventListener('pagehide',()=>{void flushArchetypeWrites().catch(error=>console.error('Save on pagehide failed',error))});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void flushArchetypeWrites().catch(error=>console.error('Save while hidden failed',error))});
function saveLooks(){queueArchetypeWrite(target,{look:looks[target]})}
const libraryActionDialog=document.getElementById('libraryActionDialog'),libraryActionInput=document.getElementById('libraryActionInput');
function askLibraryAction({title,label='NAME',value='',message='',confirm='CONFIRM',requireInput=true}){
 document.getElementById('libraryActionTitle').textContent=title;
 document.getElementById('libraryActionLabel').textContent=label;
 document.getElementById('libraryActionLabel').hidden=!requireInput;
 libraryActionInput.hidden=!requireInput;libraryActionInput.required=requireInput;libraryActionInput.value=value;
 document.getElementById('libraryActionMessage').textContent=message;
 document.getElementById('confirmLibraryAction').textContent=confirm;
 libraryActionDialog.showModal();if(requireInput)libraryActionInput.focus();
 return new Promise(resolve=>{
  const finish=result=>{libraryActionDialog.close();resolve(result)};
  document.getElementById('libraryActionForm').onsubmit=event=>{event.preventDefault();finish(requireInput?libraryActionInput.value.trim():true)};
  document.getElementById('cancelLibraryAction').onclick=()=>finish(null);
  document.getElementById('closeLibraryAction').onclick=()=>finish(null);
  libraryActionDialog.oncancel=()=>resolve(null);
 });
}
const lookPanel=document.getElementById('lookPanel'),lookPreset=document.getElementById('lookPreset');
function renderProjectLookPresets(){
 lookPreset.innerHTML='<option value="">Select a look…</option><option value="blank">Blank</option>';
 FACTORY_LOOKS.forEach(preset=>{const option=document.createElement('option');option.value='factory:'+preset.id;option.textContent=preset.name;lookPreset.appendChild(option)});
 const list=document.getElementById('projectLookPresetList');list.replaceChildren();
 projectLookPresets.forEach(preset=>{
  const option=document.createElement('option');option.value='project:'+preset.id;option.textContent='Project · '+preset.name;lookPreset.appendChild(option);
  const row=document.createElement('div');row.className='projectLookPresetRow';const label=document.createElement('span');label.textContent=preset.name;row.appendChild(label);
  for(const [glyph,title,action] of [['pencil','Rename look preset',async()=>{const name=await askLibraryAction({title:'RENAME LOOK PRESET',value:preset.name,confirm:'RENAME'});if(name)await repository.updateLookPreset(preset.id,{name})}],
    ['trash-2','Delete look preset',async()=>{if(await askLibraryAction({title:'DELETE LOOK PRESET',message:`Delete “${preset.name}” from this project?`,confirm:'DELETE',requireInput:false}))await repository.deleteLookPreset(preset.id)}]]){
    const button=document.createElement('button');button.className='iconAction';button.innerHTML=icon(glyph);button.setAttribute('aria-label',title+' '+preset.name);button.dataset.tooltip=title;
    button.onclick=async()=>{try{await action();projectLookPresets=await repository.listLookPresets(activeProject.id);renderProjectLookPresets()}catch(error){alert(error.message)}};row.appendChild(button)
  }list.appendChild(row);
 });
}
function closeLookEditor(){lookPanel.classList.remove('open')}
function updateLookRoutingWarning(){
 const map=routingMaps[target],empty=routeSources.every(source=>routeTargets.every(key=>!Number(map?.[source]?.[key])));
 document.getElementById('lookRoutingWarning').hidden=!empty;
}
function renderLookEditor(){
 document.getElementById('lookArchName').textContent=archetypes[target].name;
 const root=document.getElementById('lookFields');root.replaceChildren();
 const groups=[
  ['distortion','DISTORTION',[['amplitude','Amplitude'],['speed','Speed'],['mode','Mode'],['angle','Angle (degrees)'],['directionStrength','Direction strength']]],
  ['color','COLOR',[['gain','Gain'],['tint','Tint'],['tintAmount','Tint amount']]],
  ['particles','PARTICLES',[['density','Density'],['speed','Speed'],['style','Style'],['motion','Motion'],['color','Color'],['motionFactor','Motion factor'],['waveAmount','Wave amount'],['jitterAmount','Jitter amount'],['depthOffset','Depth offset'],['streakSlant','Streak slant']]],
 ];
 const options={mode:['directional','radial'],style:['dots','rings','streaks'],motion:['rise','wave-flow','radial','jitter-flow','depth-flow']};
 for(const [group,title,fields] of groups){
  const section=document.createElement('section');section.className='lookGroup';const heading=document.createElement('h3');heading.textContent=title;section.appendChild(heading);
  for(const [key,label] of fields){
   const row=document.createElement('label');row.className='lookField';row.dataset.field=key;
   const caption=document.createElement('span');caption.textContent=label;row.appendChild(caption);
   const value=looks[target][group][key];let input;
   if(options[key]){input=document.createElement('select');for(const choice of options[key]){const item=document.createElement('option');item.value=choice;item.textContent=choice.replaceAll('-',' ');input.appendChild(item)}input.value=value}
   else{input=document.createElement('input');input.type=key==='tint'||key==='color'?'color':'number';input.value=String(value);if(input.type==='number'){const [min,max,step]=LOOK_FIELDS[group][key];input.min=String(min);input.max=String(max);input.step=String(step)}}
   input.setAttribute('aria-label',`${title.toLowerCase()} ${label.toLowerCase()}`);
   input.addEventListener('input',()=>{if(input.type==='number'&&!Number.isFinite(input.valueAsNumber))return;looks[target]=normalizeLook({...looks[target],[group]:{...looks[target][group],[key]:input.type==='number'?input.valueAsNumber:input.value}});saveLooks();if(group==='distortion'&&key==='mode')section.querySelector('[data-field="angle"]').hidden=input.value!=='directional'});
   row.appendChild(input);section.appendChild(row);
  }
  if(group==='distortion')section.querySelector('[data-field="angle"]').hidden=looks[target].distortion.mode!=='directional';
  root.appendChild(section);
 }
 lookPreset.value='';updateLookRoutingWarning();
}
document.getElementById('lookBtn').onclick=()=>{closeImageManager();closeMappingMatrix();closeArchetypeCreator();renderLookEditor();lookPanel.classList.add('open')};
document.getElementById('closeLook').onclick=closeLookEditor;
lookPreset.onchange=async()=>{
 const value=lookPreset.value;if(!value)return;
 const factory=FACTORY_LOOKS.find(preset=>value==='factory:'+preset.id),projectPreset=projectLookPresets.find(preset=>value==='project:'+preset.id);
 const label=value==='blank'?'Blank':factory?.name||projectPreset?.name;if(!label){lookPreset.value='';return}
 if(!await askLibraryAction({title:'REPLACE LOOK',message:`Replace ${archetypes[target].name}'s current look with ${label}? This cannot be undone.`,confirm:'REPLACE',requireInput:false})){lookPreset.value='';return}
 looks[target]=normalizeLook(value==='blank'?NEUTRAL_LOOK:factory?.look||projectPreset.look);saveLooks();renderLookEditor();
};
document.getElementById('saveLookPreset').onclick=async()=>{
 if(!activeProject||!archetypes[target])return;const name=await askLibraryAction({title:'SAVE LOOK PRESET',confirm:'SAVE'});if(!name)return;
 try{await repository.createLookPreset(activeProject.id,name,looks[target]);projectLookPresets=await repository.listLookPresets(activeProject.id);renderProjectLookPresets()}
 catch(error){alert(error.message)}
};
let routingMaps=[];
const addedTargetKeys=new Set(['rotate','spiral','tiles']);
function saveRoutingMaps(){queueArchetypeWrite(target,{routingMap:routingMaps[target]})}
function renderMatrixEditor(){
 const a=(typeof target==='number')?target:0;document.getElementById('matrixArchName').textContent=archetypes[a].name;
 let h='<table class="mapTable"><thead><tr><th>SOURCE ↓ / TARGET →</th>';routeTargets.forEach(t=>h+='<th>'+targetLabels[t]+'</th>');h+='</tr></thead><tbody>';
 routeSources.forEach(s=>{h+='<tr><td class="srcLabel">'+sourceLabels[s]+'</td>';routeTargets.forEach(t=>{const v=Number(routingMaps[a][s][t]||0);h+='<td><input class="mapCell '+(Math.abs(v)>.001?'nz':'')+'" data-s="'+s+'" data-t="'+t+'" type="number" min="-1.5" max="1.5" step="0.05" value="'+v.toFixed(2)+'"></td>'});h+='</tr>'});h+='</tbody></table>';
 document.getElementById('matrixHolder').innerHTML=h;document.querySelectorAll('.mapCell').forEach(el=>{el.oninput=()=>{const v=Math.max(-1.5,Math.min(1.5,parseFloat(el.value)||0));routingMaps[a][el.dataset.s][el.dataset.t]=v;el.classList.toggle('nz',Math.abs(v)>.001);saveRoutingMaps();if(lookPanel.classList.contains('open'))updateLookRoutingWarning()}})
}
function closeMappingMatrix(){saveRoutingMaps();document.getElementById('matrixPanel').classList.remove('open')}
document.getElementById('openMatrix').onclick=()=>{closeImageManager();closeLookEditor();renderMatrixEditor();document.getElementById('matrixPanel').classList.add('open')};
document.getElementById('closeMatrix').onclick=closeMappingMatrix;
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'){
   const openDialog=document.querySelector('dialog[open]');if(openDialog){openDialog.close();return}
   if(document.getElementById('matrixPanel').classList.contains('open'))closeMappingMatrix();
   if(document.getElementById('imagePanel').classList.contains('open'))closeImageManager();
   if(lookPanel.classList.contains('open'))closeLookEditor();
   if(document.getElementById('creatorPanel').classList.contains('open'))closeArchetypeCreator();
   if(document.getElementById('audioInputPanel').classList.contains('open'))document.getElementById('audioInputPanel').classList.remove('open');
 }
});
document.getElementById('zeroMap').onclick=()=>{routingMaps[target]=blankMap();saveRoutingMaps();renderMatrixEditor();if(lookPanel.classList.contains('open'))updateLookRoutingWarning()};
document.getElementById('resetMap').onclick=()=>{routingMaps[target]=JSON.parse(JSON.stringify(defaultRoutingMaps[target]));saveRoutingMaps();renderMatrixEditor();if(lookPanel.classList.contains('open'))updateLookRoutingWarning()};

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
 zoom:document.getElementById('g-zoom'),
 rotate:document.getElementById('g-rotate'),
 spiral:document.getElementById('g-spiral'),
 tiles:document.getElementById('g-tiles')
};
const globalAuto = {
 pulse:document.getElementById('ga-pulse'),
 dist:document.getElementById('ga-dist'),
 glow:document.getElementById('ga-glow'),
 luma:document.getElementById('ga-luma'),
 sat:document.getElementById('ga-sat'),
 parts:document.getElementById('ga-parts'),
 zoom:document.getElementById('ga-zoom'),
 rotate:document.getElementById('ga-rotate'),
 spiral:document.getElementById('ga-spiral'),
 tiles:document.getElementById('ga-tiles')
};
const targetState={enabled:Object.fromEntries(routeTargets.map(key=>[key,true])),solo:Object.fromEntries(routeTargets.map(key=>[key,false]))};
document.querySelectorAll('[data-target-on]').forEach(input=>input.onchange=()=>{targetState.enabled[input.dataset.targetOn]=input.checked});
document.querySelectorAll('[data-target-solo]').forEach(button=>button.onclick=()=>{
 const key=button.dataset.targetSolo;targetState.solo[key]=!targetState.solo[key];
 button.classList.toggle('active',targetState.solo[key]);button.setAttribute('aria-pressed',String(targetState.solo[key]));
});
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

let musicPresets=[];
function saveMusicPresets(){queueArchetypeWrite(target,{musicPresets:musicPresets[target]})}
function captureMusicPreset(name){
  const amounts={};sourceKeys.forEach(k=>amounts[k]=+document.getElementById('amt-'+k).value);
  const intensity={},reactivity={};routeTargets.forEach(k=>{intensity[k]=+globalCtl[k].value;reactivity[k]=+globalAuto[k].value});
  return {name,enabled:{...modState.enabled},solo:{...modState.solo},amounts,intensity,reactivity,targetEnabled:{...targetState.enabled},targetSolo:{...targetState.solo},ctxPerf:+ctxPerf.value,globalReact:+document.getElementById('react').value,routing:JSON.parse(JSON.stringify(routingMaps[target]))};
}
function applyMusicPreset(p){
  if(!p)return;
  sourceKeys.forEach(k=>{
    modState.enabled[k]=p.enabled?.[k]!==false;modState.solo[k]=!!p.solo?.[k];
    const amt=document.getElementById('amt-'+k);if(p.amounts?.[k]!=null)amt.value=p.amounts[k];document.getElementById('show-'+k).textContent=(+amt.value).toFixed(2);
    const on=document.querySelector('[data-on="'+k+'"]'),solo=document.querySelector('[data-solo="'+k+'"]');on.checked=modState.enabled[k];solo.classList.toggle('active',modState.solo[k]);
  });
  routeTargets.forEach(k=>{
    if(p.intensity?.[k]!=null)globalCtl[k].value=p.intensity[k];else if(addedTargetKeys.has(k))globalCtl[k].value=0;
    if(p.reactivity?.[k]!=null)globalAuto[k].value=p.reactivity[k];else if(addedTargetKeys.has(k))globalAuto[k].value=1;
    targetState.enabled[k]=p.targetEnabled?.[k]!==false;targetState.solo[k]=!!p.targetSolo?.[k];
    document.querySelector('[data-target-on="'+k+'"]').checked=targetState.enabled[k];
    const solo=document.querySelector('[data-target-solo="'+k+'"]');solo.classList.toggle('active',targetState.solo[k]);solo.setAttribute('aria-pressed',String(targetState.solo[k]));
  });
  if(p.ctxPerf!=null){ctxPerf.value=p.ctxPerf;ctxPerfVal.textContent=(+ctxPerf.value).toFixed(2)}
  if(p.globalReact!=null)document.getElementById('react').value=String(p.globalReact);
  if(p.routing)routingMaps[target]=normalizeRoutingMap(p.routing,defaultRoutingMaps[target]);
  saveRoutingMaps();
  if(document.getElementById('matrixPanel').classList.contains('open'))renderMatrixEditor();
}
function syncPresetActions(){
  const hasSelection=document.getElementById('presetSelect').value!=='';
  document.getElementById('presetSelect').disabled=!archetypes.length;
  document.getElementById('presetSave').disabled=!archetypes.length;
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
  const live=!!inputController?.inputActive;
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
  const activeTargets=resolveTargetActivity(targetState);
  FinalG=computeTargetState({map,sources:rawSrc,activeSources:activeSrc,activeTargets,intensity,reactivity,globalReactivity:+document.getElementById('react').value});
  routeTargets.forEach(k=>document.getElementById('gf-'+k).textContent=FinalG[k].toFixed(2));
  return FinalG;
}


function mediaUrl(source){return typeof source==='string'?source:source.url}
function mediaIsVideo(source){return typeof source!=='string'&&source.type?.startsWith('video/')}
const defaultImageConfigs=[];
let imageConfigs=[];
function saveImageConfigs(){queueArchetypeWrite(target,{imageConfig:imageConfigs[target]})}
function createSequenceState(){return {current:0,next:1,blend:0,rawProgress:0,transitioning:false,loading:false,loadingTarget:null,pendingRequest:null,poolStates:{timed:{},event:{},manual:{}},orderState:{},shownHistory:[0],shownHistoryCursor:0,nextAutoAt:null,lastReliableBpm:0,scheduledTempo:null,transStart:0,durationMs:0,transitionId:'crossfade',transitionShaderId:transitionShaderId('crossfade'),seed:0,param:[0,0,0,0],easing:'linear',lastSwitch:performance.now(),lastMappedSignal:0}}
const seqStates=archetypes.map(createSequenceState);
function orderedImages(a,enabledOnly=false){
 return imageConfigs[a].images.map((im,i)=>({i,order:im.order,enabled:im.enabled&&!IMAGE_SETS[a]?.[i]?.missing})).filter(x=>!enabledOnly||x.enabled).sort((x,y)=>x.order-y.order||x.i-y.i).map(x=>x.i);
}
function enabledImages(a){return orderedImages(a,true)}
function chooseOrderedImage(a,direction=1){
 const s=seqStates[a],mode=imageConfigs[a].orderMode;
 if((mode==='random-no-repeat'||mode==='shuffle')&&direction<0){s.shownHistoryCursor=Math.max(0,s.shownHistoryCursor-1);return s.shownHistory[s.shownHistoryCursor]??s.current}
 if((mode==='random-no-repeat'||mode==='shuffle')&&s.shownHistoryCursor<s.shownHistory.length-1){s.shownHistoryCursor+=1;return s.shownHistory[s.shownHistoryCursor]}
 const result=nextSequenceIndex({enabled:enabledImages(a),current:navigationBase(s),direction,mode,state:s.orderState});
 s.orderState=result.state;return result.index;
}
function sequenceTempo(a){
 const s=seqStates[a],tempo=resolveSequencerTempo({bpm:BPM,confidence:BPMConfidence,lastReliableBpm:s.lastReliableBpm});
 s.lastReliableBpm=tempo.lastReliableBpm;return tempo;
}
function imageDwell(a,index,tempo=sequenceTempo(a)){
 const cfg=imageConfigs[a],image=cfg.images[index];
 if(cfg.timeBase==='beats'){
   const requested=image.durationBeats||4,effective=effectiveBeatDwell(requested,tempo.bpm);
   return {seconds:beatsToSeconds(effective,tempo.bpm),requestedBeats:requested,effectiveBeats:effective,tempo};
 }
 return {seconds:Math.max(2,image.duration||10),tempo};
}
function beatLabel(value){return value<1?({'.125':'1/8','.25':'1/4','.5':'1/2'}[String(value)]||String(value)):String(value)}
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
const triggerLabels={timed:['TIMED','Auto and continuous mapping'],event:['EVENT','Beat, kick and snare'],manual:['MANUAL','Buttons and shortcuts']};
function navigationBase(s){return s.pendingRequest?.idx??s.loadingTarget??(s.transitioning?s.next:s.current)}
function renderTriggerTransitionControls(a){
 const root=document.getElementById('triggerTransitionControls'),cfg=imageConfigs[a];
 root.innerHTML=IMAGE_TRIGGER_CLASSES.map(triggerClass=>{
   const settings=cfg.triggers[triggerClass],labels=triggerLabels[triggerClass];
   const pool=TRANSITIONS.map(item=>`<label><input type="checkbox" data-trigger-pool="${triggerClass}" value="${item.id}" ${settings.pool.includes(item.id)?'checked':''}>${item.label}</label>`).join('');
   const orders=['cycle','random-no-repeat'].map(id=>`<option value="${id}" ${settings.pickOrder===id?'selected':''}>${id==='cycle'?'Cycle':'Random · no repeat'}</option>`).join('');
   const easings=EASINGS.map(item=>`<option value="${item.id}" ${settings.easing===item.id?'selected':''}>${item.label}</option>`).join('');
   const wipes=WIPE_DIRECTIONS.map(item=>`<option value="${item.id}" ${settings.wipeDirection===item.id?'selected':''}>${item.label}</option>`).join('');
   const duration=cfg.timeBase==='beats'?`<select data-trigger-duration-beats="${triggerClass}">${TRANSITION_BEAT_OPTIONS.map(value=>`<option value="${value}" ${settings.durationBeats===value?'selected':''}>${beatLabel(value)} beat${value===1?'':'s'}</option>`).join('')}</select>`:`<input data-trigger-duration="${triggerClass}" type="number" min="0.05" max="8" step="0.05" value="${settings.duration}">`;
   return `<section class="triggerTransitionGroup" data-trigger-section="${triggerClass}"><div class="triggerTransitionHead"><div><b>${labels[0]}</b><span> · ${labels[1]}</span></div><button type="button" data-trigger-test="${triggerClass}">TEST</button></div><div class="transitionPool">${pool}</div><div class="triggerSettings"><label>PICK ORDER<select data-trigger-order="${triggerClass}">${orders}</select></label><label>DURATION · ${cfg.timeBase==='beats'?'BEATS':'SEC'}${duration}</label><label>EASING<select data-trigger-easing="${triggerClass}">${easings}</select></label><label class="triggerWipe" ${settings.pool.includes('wipe')?'':'hidden'}>WIPE DIRECTION<select data-trigger-wipe="${triggerClass}">${wipes}</select></label></div></section>`;
 }).join('');
 root.querySelectorAll('[data-trigger-pool]').forEach(input=>input.onchange=()=>{
   const settings=cfg.triggers[input.dataset.triggerPool],checked=[...root.querySelectorAll(`[data-trigger-pool="${input.dataset.triggerPool}"]:checked`)].map(item=>item.value);
   if(!checked.length){input.checked=true;return}
   settings.pool=checked;root.querySelector(`[data-trigger-section="${input.dataset.triggerPool}"] .triggerWipe`).hidden=!checked.includes('wipe');saveImageConfigs();
 });
 root.querySelectorAll('[data-trigger-order]').forEach(el=>el.onchange=()=>{cfg.triggers[el.dataset.triggerOrder].pickOrder=el.value;saveImageConfigs()});
 root.querySelectorAll('[data-trigger-duration]').forEach(el=>el.onchange=()=>{const settings=cfg.triggers[el.dataset.triggerDuration];settings.duration=clamp(parseFloat(el.value)||2.2,.05,8);el.value=settings.duration;saveImageConfigs()});
 root.querySelectorAll('[data-trigger-duration-beats]').forEach(el=>el.onchange=()=>{cfg.triggers[el.dataset.triggerDurationBeats].durationBeats=+el.value;saveImageConfigs()});
 root.querySelectorAll('[data-trigger-easing]').forEach(el=>el.onchange=()=>{cfg.triggers[el.dataset.triggerEasing].easing=el.value;saveImageConfigs()});
 root.querySelectorAll('[data-trigger-wipe]').forEach(el=>el.onchange=()=>{cfg.triggers[el.dataset.triggerWipe].wipeDirection=el.value;saveImageConfigs()});
 root.querySelectorAll('[data-trigger-test]').forEach(el=>el.onclick=()=>requestImageChange(a,chooseOrderedImage(a,1),el.dataset.triggerTest));
}
function updateImageManagerRuntimeState(a){
 if(target!==a||!document.getElementById('imagePanel').classList.contains('open'))return;
 const cfg=imageConfigs[a],s=seqStates[a],active=enabledImages(a),orderPos=active.indexOf(s.current);
 document.querySelectorAll('#imageGrid [data-imgcard]').forEach(card=>card.classList.toggle('current',+card.dataset.imgcard===s.current));
 const beatStatus=document.getElementById('beatTimeStatus'),tempo=sequenceTempo(a);
 beatStatus.hidden=cfg.timeBase!=='beats';
 beatStatus.textContent=cfg.timeBase==='beats'?'BEATS · '+(tempo.source==='live'?Math.round(tempo.bpm)+' BPM':(tempo.source==='last'?'LAST RELIABLE ':'FALLBACK ')+Math.round(tempo.bpm)):'';
 document.getElementById('imageManagerStatus').textContent='Current IMAGE '+(s.current+1)+' · active position '+(orderPos>=0?orderPos+1:'—')+' / '+active.length+' · mode '+cfg.mode.toUpperCase();
}
function renderImageManager(){
 const a=target,cfg=imageConfigs[a],s=seqStates[a];
 document.getElementById('imageArchName').textContent=archetypes[a].name;
 document.getElementById('imageMode').value=cfg.mode;
 document.getElementById('imageTimeBase').value=cfg.timeBase;
 document.getElementById('imageOrderMode').value=cfg.orderMode;
 document.getElementById('imageSource').value=cfg.source;
 document.getElementById('imageThreshold').value=cfg.threshold;
 renderTriggerTransitionControls(a);
 let h='';
 const visualOrder=orderedImages(a,false);
 visualOrder.forEach((i,pos)=>{
   const im=cfg.images[i];
   let opts='';for(let p=0;p<cfg.images.length;p++)opts+='<option value="'+p+'" '+(p===pos?'selected':'')+'>'+(p+1)+'</option>';
   const source=IMAGE_SETS[a][i],preview=source?.missing?'<div class="imageThumb missingThumb">MISSING MEDIA</div>':mediaIsVideo(source)?'<video class="imageThumb" src="'+mediaUrl(source)+'" muted loop playsinline autoplay></video>':'<img class="imageThumb" src="'+mediaUrl(source)+'">';
   const dwellControl=cfg.timeBase==='beats'?'<select data-imgbeats="'+i+'">'+DWELL_BEAT_OPTIONS.map(value=>'<option value="'+value+'" '+(im.durationBeats===value?'selected':'')+'>'+value+'</option>').join('')+'</select>':'<input type="number" data-imgdur="'+i+'" min="2" max="60" step="1" value="'+im.duration+'">';
   const dwellInfo=cfg.timeBase==='beats'?imageDwell(a,i):null,effective=dwellInfo&&dwellInfo.effectiveBeats!==dwellInfo.requestedBeats?'<div class="effectiveDwell">'+dwellInfo.requestedBeats+' BEAT'+(dwellInfo.requestedBeats===1?'':'S')+' → '+dwellInfo.effectiveBeats+' BEATS @ '+Math.round(dwellInfo.tempo.bpm)+' BPM</div>':'';
   h+='<div class="imageCard '+(s.current===i?'current':'')+'" data-imgcard="'+i+'">'+preview+'<div class="cardLine"><b>'+(source?.missing?'MISSING MEDIA · ':mediaIsVideo(source)?'VIDEO ':'IMAGE ')+(i+1)+'</b><label><input type="checkbox" data-imgen="'+i+'" '+(im.enabled?'checked':'')+' '+(source?.missing?'disabled':'')+'> ON</label></div><div class="cardLine"><span>Dwell '+(cfg.timeBase==='beats'?'beats':'sec')+'</span>'+dwellControl+'</div>'+effective+'<div class="cardLine"><span>Order</span><div class="orderCtl"><button data-imgup="'+i+'" aria-label="Move image earlier">'+icon('arrow-up')+'</button><select data-imgorder="'+i+'">'+opts+'</select><button data-imgdown="'+i+'" aria-label="Move image later">'+icon('arrow-down')+'</button></div></div></div>';
 });
 document.getElementById('imageGrid').innerHTML=h;
 updateImageManagerRuntimeState(a);
 document.querySelectorAll('[data-imgen]').forEach(el=>el.onchange=()=>{
   const i=+el.dataset.imgen;
   imageConfigs[a].images[i].enabled=el.checked;
   if(!enabledImages(a).length){imageConfigs[a].images[i].enabled=true;el.checked=true}
   saveImageConfigs();
   if(!imageConfigs[a].images[s.current].enabled){const nxt=enabledImages(a)[0];if(nxt!=null)requestImageChange(a,nxt,'manual')}
 });
 document.querySelectorAll('[data-imgdur]').forEach(el=>el.onchange=()=>{
   const i=+el.dataset.imgdur;imageConfigs[a].images[i].duration=clamp(parseFloat(el.value)||10,2,60);el.value=imageConfigs[a].images[i].duration;seqStates[a].nextAutoAt=null;saveImageConfigs();
 });
 document.querySelectorAll('[data-imgbeats]').forEach(el=>el.onchange=()=>{const i=+el.dataset.imgbeats;imageConfigs[a].images[i].durationBeats=+el.value;seqStates[a].nextAutoAt=null;saveImageConfigs();renderImageManager()});
 document.querySelectorAll('[data-imgorder]').forEach(el=>el.onchange=()=>{moveImageToPosition(a,+el.dataset.imgorder,+el.value);renderImageManager()});
 document.querySelectorAll('[data-imgup]').forEach(el=>el.onclick=()=>{moveImageBy(a,+el.dataset.imgup,-1);renderImageManager()});
 document.querySelectorAll('[data-imgdown]').forEach(el=>el.onclick=()=>{moveImageBy(a,+el.dataset.imgdown,1);renderImageManager()});
}
function closeImageManager(){saveImageConfigs();document.getElementById('imagePanel').classList.remove('open')}
document.getElementById('imageMgrBtn').onclick=()=>{closeMappingMatrix();closeLookEditor();renderImageManager();document.getElementById('imagePanel').classList.add('open')};
document.getElementById('closeImageMgr').onclick=closeImageManager;
const imageTutorialDialog=document.getElementById('imageTutorialDialog');
document.getElementById('openImageTutorial').onclick=()=>{if(!imageTutorialDialog.open)imageTutorialDialog.showModal()};
document.getElementById('closeImageTutorial').onclick=()=>imageTutorialDialog.close();
document.getElementById('imageMode').onchange=e=>{imageConfigs[target].mode=e.target.value;seqStates[target].lastSwitch=performance.now();seqStates[target].lastMappedSignal=0;seqStates[target].nextAutoAt=null;saveImageConfigs();renderImageManager()};
document.getElementById('imageTimeBase').onchange=e=>{imageConfigs[target].timeBase=e.target.value;seqStates[target].lastSwitch=performance.now();seqStates[target].nextAutoAt=null;saveImageConfigs();renderImageManager()};
document.getElementById('imageOrderMode').onchange=e=>{const s=seqStates[target];imageConfigs[target].orderMode=e.target.value;s.orderState={};s.shownHistory=[s.current];s.shownHistoryCursor=0;saveImageConfigs();renderImageManager()};
document.getElementById('imageSource').onchange=e=>{imageConfigs[target].source=e.target.value;seqStates[target].lastMappedSignal=0;saveImageConfigs()};
document.getElementById('imageThreshold').onchange=e=>{imageConfigs[target].threshold=clamp(parseFloat(e.target.value)||.55,.05,.95);e.target.value=imageConfigs[target].threshold;saveImageConfigs()};
document.getElementById('imgPrev').onclick=()=>requestImageChange(target,chooseOrderedImage(target,-1),'manual');
document.getElementById('imgNext').onclick=()=>requestImageChange(target,chooseOrderedImage(target,1),'manual');

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
   const remove=document.createElement('button');remove.type='button';remove.className='creatorRemoveMedia';remove.innerHTML=icon('x');remove.title='Remove from archetype';remove.setAttribute('aria-label','Remove '+file.name);
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
 closeImageManager();closeMappingMatrix();closeLookEditor();
 const select=document.getElementById('customArchTemplate');select.innerHTML='';
 const blank=document.createElement('option');blank.value='blank';blank.textContent='Blank';select.appendChild(blank);
 FACTORY_LOOKS.forEach(preset=>{const option=document.createElement('option');option.value='factory:'+preset.id;option.textContent=preset.name;select.appendChild(option)});
 projectLookPresets.forEach(preset=>{const option=document.createElement('option');option.value='preset:'+preset.id;option.textContent='Project · '+preset.name;select.appendChild(option)});
 select.value='factory:'+FACTORY_LOOKS[0].id;
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
 const name=document.getElementById('customArchName').value.trim(),choice=document.getElementById('customArchTemplate').value,button=document.getElementById('createArchetype');
 if(!activeProject){creatorStatus.textContent='Create a project first.';return}
 if(!name){creatorStatus.textContent='Give the archetype a name.';return}
 if(!pendingArchetypeFiles.length){creatorStatus.textContent='Select or generate at least one image.';return}
 button.disabled=true;creatorStatus.textContent='Saving media locally…';
 try{
   const factory=choice.startsWith('factory:')?FACTORY_LOOKS.find(item=>item.id===choice.slice(8)):null;
   const preset=choice.startsWith('preset:')?projectLookPresets.find(item=>item.id===choice.slice(7)):null;
   const origin={type:factory?'factory':preset?'project-preset':'blank',presetId:factory?.id||preset?.id||null};
   const media=[];for(const file of pendingArchetypeFiles){const saved=await repository.putMedia(file,file.type);media.push({mediaId:saved.id,name:file.name,mime:saved.mime,size:saved.size})}
   const item=await repository.createArchetype(activeProject.id,{name,origin,look:normalizeLook(factory?.look||preset?.look||NEUTRAL_LOOK),
     routingMap:factory?structuredClone(factory.starter.routingMap):blankMap(),imageConfig:defaultImageConfig(media.length,factory?.starter.imageSource),musicPresets:[],media});
   closeArchetypeCreator();document.getElementById('customArchName').value='';await openProject(activeProject.id,{preferredId:item.id});
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

const names=['uRes','uTime','uMorphA','uMorphB','uTransA','uTransB','uSeedA','uSeedB','uParamA','uParamB','uWarpA','uWarpB','uWarpDirA','uWarpDirB','uGradeA','uGradeB','uArchMix','uMapPulse','uDistAmt','uGlowAmt','uLumAmt','uSatAmt','uZoomAmt','uRotateAmt','uSpiralAmt','uTilesAmt'];
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
   if(source?.missing){bindTextureSlot(role,slot);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([12,16,22,255]));resolve();return}
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
const pendingMediaLoads=new Set();
function trackedMediaLoad(role,slot,a,imgIdx){
 const load=uploadMediaToSlot(role,slot,a,imgIdx);pendingMediaLoads.add(load);load.finally(()=>pendingMediaLoads.delete(load));return load;
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
function createSequenceTransition(a,from,to,triggerClass){
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
function sequenceTransitionPayload(s,a){return {archetypeId:archetypes[a]?.id,from:s.current,to:s.next,transitionId:s.transitionId,seed:s.seed,param:[...s.param],easing:s.easing,duration:s.durationMs/1000}}
function advanceSequenceTransition(role,a,now){
 const s=seqStates[a];if(!s?.transitioning)return false;
 s.rawProgress=s.durationMs>0?Math.min(1,(now-s.transStart)/s.durationMs):1;
 s.blend=s.transitionId==='cut'?1:applyTransitionEasing(s.rawProgress,s.easing);
 if(s.rawProgress<1)return false;
 swapTextureSlots(role);s.current=s.next;s.blend=0;s.rawProgress=0;s.transitioning=false;s.lastSwitch=now;s.nextAutoAt=null;
 if(!isShowMode){s.shownHistory=s.shownHistory.slice(0,s.shownHistoryCursor+1);if(s.shownHistory.at(-1)!==s.current)s.shownHistory.push(s.current);s.shownHistoryCursor=s.shownHistory.length-1}
 if(!isShowMode)updateImageManagerRuntimeState(a);
 return true;
}
function completeSequenceTransition(role,a,now=performance.now()){
 const s=seqStates[a];if(!s?.transitioning)return false;
 s.transStart=now-s.durationMs;s.rawProgress=1;return advanceSequenceTransition(role,a,now);
}
async function requestImageChange(a,idx,triggerClass=null){
 const s=seqStates[a];
 if(projectSwitching||deletingArchetype||panicActive||!imageConfigs[a].images[idx]?.enabled)return;
 triggerClass=triggerClass||classifyImageTrigger(imageConfigs[a]);
 const request={idx,triggerClass};
 if(s.loading){s.pendingRequest=resolvePendingImageRequest(s.pendingRequest,request);return}
 if(s.transitioning)completeSequenceTransition(1,a);
 if(idx===s.current)return;
 s.loading=true;s.loadingTarget=idx;
 await trackedMediaLoad(1,1,a,idx);
 if(projectSwitching){s.loading=false;s.loadingTarget=null;s.pendingRequest=null;return}
 s.loading=false;s.loadingTarget=null;
 if(panicActive){s.pendingRequest=null;return}
 if(s.pendingRequest){const pending=s.pendingRequest;s.pendingRequest=null;if(pending.idx!==idx){requestImageChange(a,pending.idx,pending.triggerClass);return}triggerClass=pending.triggerClass}
 const now=performance.now(),transition=createSequenceTransition(a,s.current,idx,triggerClass);beginSequenceTransition(s,transition,now);
 showChannel?.postMessage({type:'transition-start',transition:sequenceTransitionPayload(s,a)});
 if(s.transitionId==='cut')advanceSequenceTransition(1,a,now);
}
function updateImageSequence(now,Eff,freezeAdvances=false){
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
 s.current=i0;s.next=i1;
 await Promise.all([trackedMediaLoad(role,0,a,i0),trackedMediaLoad(role,1,a,i1)]);
}
const remoteRoleSignatures=['',''],remoteTransitionSignatures=['',''],remoteRoleTokens=[0,0];
function syncRemoteRole(role,a,state){
 if(projectSwitching||!state||!IMAGE_SETS[a])return;
 const i0=Math.max(0,Math.min(IMAGE_SETS[a].length-1,state.current||0));
 const i1=Math.max(0,Math.min(IMAGE_SETS[a].length-1,state.next??i0));
 const signature=`${a}:${i0}:${i1}`;
 if(remoteRoleSignatures[role]===signature)return;
 remoteRoleSignatures[role]=signature;const token=++remoteRoleTokens[role];
 Promise.all([trackedMediaLoad(role,0,a,i0),trackedMediaLoad(role,1,a,i1)]).then(()=>{
   if(token!==remoteRoleTokens[role])return;
   const seq=seqStates[a];seq.current=i0;seq.next=i1;seq.blend=0;seq.rawProgress=0;seq.transitioning=false;
 }).catch(error=>console.error('Unable to synchronize show media',error));
}
function remoteTransitionSignature(transition,role){return `${role}:${transition.archetypeId}:${transition.from}:${transition.to}:${transition.seed}`}
async function startRemoteImageTransition(transition,initialRawProgress=0,forcedRole=null){
 const a=idToIndex.get(transition?.archetypeId);
 if(projectSwitching||!isShowMode||!transition||a==null||!IMAGE_SETS[a])return;
 const role=forcedRole??(a===current&&a!==target?0:1),signature=remoteTransitionSignature(transition,role);
 if(remoteTransitionSignatures[role]===signature)return;
 const sourceReady=remoteRoleSignatures[role].startsWith(`${a}:${transition.from}:`);
 remoteTransitionSignatures[role]=signature;remoteRoleSignatures[role]=`${a}:${transition.from}:${transition.to}`;
 const token=++remoteRoleTokens[role],s=seqStates[a];s.loading=true;
 try{
   const loads=[trackedMediaLoad(role,1,a,transition.to)];
   if(!sourceReady)loads.push(trackedMediaLoad(role,0,a,transition.from));
   await Promise.all(loads);if(token!==remoteRoleTokens[role])return;
   beginSequenceTransition(s,{...transition,transitionShaderId:transitionShaderId(transition.transitionId),param:transition.param||resolveTransitionParam(transition.transitionId,'left',transition.seed)},performance.now(),initialRawProgress);
   if(s.transitionId==='cut')advanceSequenceTransition(role,a,performance.now());
 }catch(error){s.loading=false;console.error('Unable to start show transition',error)}
}
function syncRemoteSequence(role,a,state){
 if(!state)return;
 if(state.transitioning&&state.transition){startRemoteImageTransition(state.transition,state.rawProgress||0,role);return}
 if(seqStates[a]?.transitioning)return;
 remoteTransitionSignatures[role]='';syncRemoteRole(role,a,state);
}
function applyRemoteVisualState(state){
 const indexes=resolveShowIndexes(state,activeProject?.id||null,idToIndex);if(!indexes)return;
 setBlackout(!!state.blackout);
 FinalG={...NEUTRAL_TARGETS,...state.finalG};
 current=indexes.current;target=indexes.target;archMix=Number.isFinite(state.archMix)?state.archMix:1;transitioning=!!state.transitioning;
 if(current!==target)syncRemoteSequence(0,current,state.seqA);
 syncRemoteSequence(1,target,state.seqB);
}
function sequenceSnapshot(a){const s=seqStates[a];return {current:s.current,next:s.next,blend:s.blend,rawProgress:s.rawProgress,transitioning:s.transitioning,transition:s.transitioning?sequenceTransitionPayload(s,a):null}}
function broadcastShowFrame(now,Eff){
 if(!showChannel||now-lastShowBroadcastAt<40)return;
 lastShowBroadcastAt=now;
 showChannel.postMessage({type:'frame',state:{projectId:activeProject?.id||null,finalG:{...FinalG},eff:{...Eff},currentId:archetypes[current]?.id||null,targetId:archetypes[target]?.id||null,archMix,transitioning,blackout:blackoutActive,lookA:looks[current],lookB:looks[target],seqA:sequenceSnapshot(current),seqB:sequenceSnapshot(target),bpm:BPM,beat:BeatPulse,kick:KickFast,snare:SnareFast}});
}

let audioObjectUrl=null,latestAnalysis=null;
const audio=document.getElementById('audio');
const playButton=document.getElementById('play');
const seekControl=document.getElementById('seek');
const volumeControl=document.getElementById('volume');
const muteButton=document.getElementById('mute');
const trackName=document.getElementById('trackName');
const timeDisplay=document.getElementById('timeDisplay');
const audioDevice=document.getElementById('audioDevice'),inputTrim=document.getElementById('inputTrim');
const inputController=new AudioInputController(audio,{onDeviceChange:handleDeviceChange,onTrackEnded:handleInputLost,onFeatures:applyAnalysisFeatures,onAnalysisError:()=>{document.getElementById('inputWarning').textContent='Audio analysis stopped. Reload the page before performing.'}});
let seeking=false,inputMode='file',inputLostDevice='',currentInputDiagnostics=null,clipHoldUntil=0,calibrationRun=null;
const INPUT_TRIM_KEY='eyes4beat_input_trim',INPUT_CALIBRATION_KEY='eyes4beat_input_calibrations';
let inputTrims={},inputCalibrations={};
try{inputTrims=JSON.parse(localStorage.getItem(INPUT_TRIM_KEY)||'{}')||{};inputCalibrations=JSON.parse(localStorage.getItem(INPUT_CALIBRATION_KEY)||'{}')||{}}catch{}

function inputKey(){return inputMode==='live'?(inputController.deviceId||audioDevice.value||'default'):'file'}
function saveInputSettings(){try{localStorage.setItem(INPUT_TRIM_KEY,JSON.stringify(inputTrims));localStorage.setItem(INPUT_CALIBRATION_KEY,JSON.stringify(inputCalibrations))}catch{}}
function currentTrimDb(){return Number(inputTrims[inputKey()]??0)}
function currentCalibration(){const item=inputCalibrations[inputKey()];return item&&Number(item.trimDb)===currentTrimDb()?item:null}
function syncAnalysisNodes(){inputController.setAnalysisCalibration(currentCalibration())}
function applyStoredTrim(immediate=true){const value=currentTrimDb();inputTrim.value=String(value);document.getElementById('inputTrimValue').textContent=value.toFixed(1)+' dB';inputController.setTrimDb(value,immediate);inputController.setAnalysisCalibration(currentCalibration());renderCalibrationStatus()}
function resetBeatTracking(){BPM=0;BPMConfidence=0;beatAnchorSec=null;BeatPulse=0;KickFast=0;SnareFast=0;latestAnalysis=null;inputController.resetAnalysis()}

function formatTime(seconds){
 if(!Number.isFinite(seconds)||seconds<0)return '0:00';
 const minutes=Math.floor(seconds/60),rest=Math.floor(seconds%60);
 return minutes+':'+String(rest).padStart(2,'0');
}
function updateTimeDisplay(previewTime=audio.currentTime){
 timeDisplay.textContent=formatTime(previewTime)+' / '+formatTime(audio.duration);
}
function updateTransportState(){
 const fileMode=inputMode==='file';
 const isPaused=audio.paused;
 playButton.classList.toggle('playing',!isPaused);
 playButton.title=isPaused?'Play':'Pause';
 playButton.dataset.tooltip=isPaused?'Play':'Pause';
 playButton.setAttribute('aria-label',isPaused?'Play':'Pause');
 muteButton.title=audio.muted?'Unmute':'Mute';
 muteButton.dataset.tooltip=audio.muted?'Unmute':'Mute';
 muteButton.setAttribute('aria-label',audio.muted?'Unmute':'Mute');
 muteButton.classList.toggle('active',audio.muted);
 playButton.disabled=!fileMode||!audio.src;seekControl.disabled=!fileMode||!audio.src;muteButton.disabled=!fileMode||!audio.src;volumeControl.disabled=!fileMode||!audio.src;
}
let Raw={energy:0,density:0,drive:0,boombap:0,tension:0,bright:0,open:.6};
let Fast={energy:0,density:0,drive:0,boombap:0,tension:0,bright:0,open:.6};
let Context={energy:0,density:0,drive:0,boombap:0,tension:0,bright:0,open:.6};
let S={energy:0,density:0,drive:0,boombap:0,tension:0,bright:0,open:.6};
let KickFast=0, SnareFast=0;
let BPM=0, BPMConfidence=0, beatAnchorSec=null, BeatPulse=0;
const history=[];
function neutralizeInputState(){resetBeatTracking();Raw={...neutralVals};Fast={...neutralVals};Context={...neutralVals};S={...neutralVals};history.length=0}
async function ensureAudio(){
 try{await inputController.ensureContext();syncAnalysisNodes();applyStoredTrim()}
 catch(error){const message=readableInputError(error);document.getElementById('inputWarning').textContent=message;throw error}
}
document.getElementById('file').onchange=async e=>{
 const f=e.target.files[0]; if(!f)return;
 if(audioObjectUrl)URL.revokeObjectURL(audioObjectUrl);
 audioObjectUrl=URL.createObjectURL(f);audio.src=audioObjectUrl;
 inputMode='file';resetBeatTracking();
 try{await inputController.activateFile();syncAnalysisNodes();applyStoredTrim()}
 catch(error){document.getElementById('inputWarning').textContent=readableInputError(error);return}
 trackName.dataset.fileName=f.name.replace(/\.[^.]+$/,'');trackName.textContent=trackName.dataset.fileName;
 updateInputModeUi();updateInputDiagnostics(inputController.diagnostics());updateTransportState();
 try{await audio.play()}catch(error){document.getElementById('audioInputStatus').textContent='File loaded. Press play to start.'}
};
playButton.onclick=async()=>{if(inputMode!=='file')return;try{await ensureAudio();audio.paused?await audio.play():audio.pause()}catch{}};
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
function updateInputModeUi(){
 document.getElementById('fileModeBtn').classList.toggle('active',inputMode==='file');document.getElementById('liveModeBtn').classList.toggle('active',inputMode==='live');
 document.getElementById('audioInputBtn').classList.toggle('active',inputMode==='live');audioDevice.disabled=inputMode!=='live';document.getElementById('startLiveInput').disabled=inputMode!=='live';updateTransportState();
}
function updateInputDiagnostics(info){
 currentInputDiagnostics=info;const flag=value=>value===true?'ON':value===false?'OFF':'UNSUPPORTED';
 const latency=typeof info?.baseLatency==='number'?(info.baseLatency*1000).toFixed(1)+' ms':String(info?.baseLatency??'—');
 const diagnostics=document.getElementById('inputDiagnostics');diagnostics.textContent=info?`${info.mode.toUpperCase()} · ${info.label} · ${info.sampleRate} Hz · ${info.channelCount} ch · EC ${flag(info.echoCancellation)} · NS ${flag(info.noiseSuppression)} · AGC ${flag(info.autoGainControl)} · latency ${latency}`:'Waiting for source';diagnostics.title=diagnostics.textContent;
 const warning=document.getElementById('inputWarning');warning.textContent=info?.warning||'';warning.classList.toggle('active',!!info?.warning);
}
async function refreshInputDevices(){
 try{
   const devices=await inputController.enumerateInputs(),previous=audioDevice.value,stored=localStorage.getItem(INPUT_DEVICE_KEY)||'';audioDevice.innerHTML='';
   devices.forEach(device=>{const option=document.createElement('option');option.value=device.deviceId;option.textContent=device.label+(device.builtIn?' · built-in':'');audioDevice.appendChild(option)});
   const available=devices.map(device=>device.deviceId),wanted=available.includes(previous)?previous:available.includes(stored)?stored:(available[0]||'');audioDevice.value=wanted;
   if(!devices.length){const option=document.createElement('option');option.value='';option.textContent='No audio inputs found';audioDevice.appendChild(option)}
   return devices;
 }catch(error){document.getElementById('audioInputStatus').textContent=readableInputError(error);return []}
}
async function startLiveInput(deviceId=audioDevice.value){
 inputMode='live';audio.pause();updateInputModeUi();document.getElementById('audioInputStatus').textContent='Requesting audio input…';resetBeatTracking();
 try{
   const info=await inputController.activateLive(deviceId||undefined);syncAnalysisNodes();inputLostDevice='';
   const selected=deviceId||info.deviceId;if(selected)try{localStorage.setItem(INPUT_DEVICE_KEY,selected)}catch{}
   await refreshInputDevices();if(selected&&[...audioDevice.options].some(option=>option.value===selected))audioDevice.value=selected;
   trackName.textContent='LIVE: '+info.label;document.getElementById('audioInputStatus').textContent='Live input active · not routed to speakers.';applyStoredTrim();updateInputDiagnostics(info);updateTransportState();
 }catch(error){document.getElementById('audioInputStatus').textContent=readableInputError(error);trackName.textContent='LIVE INPUT UNAVAILABLE';updateInputDiagnostics(inputController.diagnostics())}
}
async function activateFileMode(){
 inputMode='file';inputLostDevice='';resetBeatTracking();
 try{await inputController.activateFile();syncAnalysisNodes();applyStoredTrim();updateInputDiagnostics(inputController.diagnostics());document.getElementById('audioInputStatus').textContent=audio.src?'File mode ready.':'Choose an audio file.';trackName.textContent=audio.src?(trackName.dataset.fileName||'Audio file'):'No track loaded'}catch(error){document.getElementById('audioInputStatus').textContent=readableInputError(error)}
 updateInputModeUi();
}
async function handleDeviceChange(){
 const devices=await refreshInputDevices();
 if(inputMode==='live'&&inputLostDevice&&devices.some(device=>device.deviceId===inputLostDevice))startLiveInput(inputLostDevice);
}
function handleInputLost(deviceId){inputLostDevice=deviceId;neutralizeInputState();trackName.textContent='LIVE: INPUT LOST';document.getElementById('audioInputStatus').textContent='Input lost. Waiting for the same device to reconnect…';updateInputDiagnostics(inputController.diagnostics())}
function renderCalibrationStatus(){
 const status=document.getElementById('calibrationStatus'),record=inputCalibrations[inputKey()],valid=currentCalibration();
 if(valid){status.textContent='CALIBRATED';status.classList.add('calibrated');document.getElementById('calibrationHint').textContent='Noise floor is active for this input and trim.'}
 else{status.textContent=record?'STALE · RECALIBRATE':'NOT CALIBRATED';status.classList.remove('calibrated');document.getElementById('calibrationHint').textContent=record?'Trim changed. Recalibrate with the instrument silent.':'Keep the instrument silent during calibration.'}
}
function beginNoiseCalibration(){
 if(!inputController.inputActive){document.getElementById('audioInputStatus').textContent='Start playback or live input before calibrating.';return}
 calibrationRun={endsAt:performance.now()+3000,samples:[]};inputController.setCalibrationCapture(true);document.getElementById('calibrateNoise').disabled=true;document.getElementById('calibrationStatus').classList.remove('calibrated');
}
function finishNoiseCalibration(){
 inputController.setCalibrationCapture(false);
 if(!calibrationRun?.samples.length){calibrationRun=null;document.getElementById('calibrateNoise').disabled=false;document.getElementById('audioInputStatus').textContent='Calibration failed: no audio samples received.';renderCalibrationStatus();return}
 const count=calibrationRun.samples.length,binCount=calibrationRun.samples.find(sample=>sample.spectrum)?.spectrum?.length||0,bins=new Array(binCount).fill(0);
 for(const sample of calibrationRun.samples)for(let index=0;index<binCount;index++)bins[index]+=(sample.spectrum?.[index]||0)/count;
 const rms=Math.sqrt(calibrationRun.samples.reduce((sum,sample)=>sum+sample.rms**2,0)/count);inputCalibrations[inputKey()]={rms,bins,trimDb:currentTrimDb(),createdAt:Date.now()};saveInputSettings();calibrationRun=null;document.getElementById('calibrateNoise').disabled=false;inputController.setAnalysisCalibration(currentCalibration());renderCalibrationStatus();
}
function renderInputMeter(meter,now){
 document.getElementById('inputLevelFill').style.width=(Math.max(0,Math.min(100,(meter.peakDb+60)/60*100)))+'%';document.getElementById('inputRms').textContent='RMS '+meter.rmsDb.toFixed(1)+' dBFS';document.getElementById('inputPeak').textContent='PEAK '+meter.peakDb.toFixed(1)+' dBFS';
 if(meter.peakDb>=-1)clipHoldUntil=now+1000;document.getElementById('inputClip').classList.toggle('active',now<clipHoldUntil);
 if(calibrationRun){const remaining=Math.max(0,calibrationRun.endsAt-now);document.getElementById('calibrationStatus').textContent='SILENCE · '+(remaining/1000).toFixed(1)+' s';if(remaining<=0)finishNoiseCalibration()}
}
document.getElementById('audioInputBtn').onclick=async()=>{closeImageManager();closeMappingMatrix();document.getElementById('creatorPanel').classList.remove('open');document.getElementById('audioInputPanel').classList.add('open');await refreshInputDevices();renderCalibrationStatus()};
document.getElementById('closeAudioInput').onclick=()=>document.getElementById('audioInputPanel').classList.remove('open');
document.getElementById('fileModeBtn').onclick=activateFileMode;document.getElementById('liveModeBtn').onclick=()=>startLiveInput();document.getElementById('startLiveInput').onclick=()=>startLiveInput();
audioDevice.onchange=()=>{try{localStorage.setItem(INPUT_DEVICE_KEY,audioDevice.value)}catch{}if(inputMode==='live')startLiveInput(audioDevice.value)};
inputTrim.oninput=()=>{const value=+inputTrim.value;inputTrims[inputKey()]=value;saveInputSettings();inputController.setTrimDb(value);document.getElementById('inputTrimValue').textContent=value.toFixed(1)+' dB';if(calibrationRun){calibrationRun=null;inputController.setCalibrationCapture(false);document.getElementById('calibrateNoise').disabled=false}renderCalibrationStatus()};
document.getElementById('calibrateNoise').onclick=beginNoiseCalibration;
document.getElementById('clearCalibration').onclick=()=>{delete inputCalibrations[inputKey()];saveInputSettings();inputController.setAnalysisCalibration(null);renderCalibrationStatus()};
refreshInputDevices();updateInputModeUi();renderCalibrationStatus();
const fullscreenButton=document.getElementById('fullscreen');
function updateFullscreenButton(){const active=!!document.fullscreenElement;fullscreenButton.classList.toggle('fullscreenActive',active);fullscreenButton.setAttribute('aria-label',active?'Exit full screen':'Full screen');fullscreenButton.dataset.tooltip=active?'Exit full screen':'Full screen'}
fullscreenButton.onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();document.addEventListener('fullscreenchange',updateFullscreenButton);updateFullscreenButton();
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
 else{panicReleaseStartedAt=performance.now();if(seqStates[target]){seqStates[target].lastSwitch=performance.now();seqStates[target].nextAutoAt=null}}
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

function applyAnalysisFeatures(features){
 latestAnalysis=features;if(!inputController.inputActive)return neutralizeInputState();
 const now=performance.now();renderInputMeter(features.meter,now);
 if(calibrationRun&&features.spectrum)calibrationRun.samples.push({rms:features.meter.rms,spectrum:features.spectrum});
 Raw={...features.raw};BPM=features.tempo.bpm;BPMConfidence=features.tempo.confidence;beatAnchorSec=BPM>0?features.timestamp-features.tempo.phase*60/BPM:null;
 BeatPulse=features.events.beat?Math.max(.35,BPMConfidence):Math.exp(-features.tempo.phase*8)*BPMConfidence;
 KickFast=features.events.kick?1:KickFast*.72;SnareFast=features.events.snare?1:SnareFast*.70;
 const lerp=(a,b,k)=>a+(b-a)*k;
 Fast.energy=lerp(Fast.energy,Raw.energy,.30);Fast.density=lerp(Fast.density,Raw.density,.22);Fast.drive=lerp(Fast.drive,Raw.drive,.26);
 Fast.boombap=lerp(Fast.boombap,Raw.boombap,.30);Fast.bright=lerp(Fast.bright,Raw.bright,.18);Fast.tension=lerp(Fast.tension,Raw.tension,.13);Fast.open=lerp(Fast.open,Raw.open,.10);
 history.push({t:features.timestamp,...Raw});while(history.length&&history[0].t<features.timestamp-20)history.shift();
 const rolling=(key,seconds,fallback)=>{let sum=0,count=0;for(let i=history.length-1;i>=0;i--){if(history[i].t<features.timestamp-seconds)break;sum+=history[i][key];count++}return count?sum/count:fallback};
 const targetContext={energy:rolling('energy',3,Fast.energy),density:rolling('density',6,Fast.density),drive:rolling('drive',4,Fast.drive),boombap:rolling('boombap',4,Fast.boombap),bright:rolling('bright',6,Fast.bright),tension:rolling('tension',12,Fast.tension),open:rolling('open',15,Fast.open)};
 Context.energy=lerp(Context.energy,targetContext.energy,.18);Context.density=lerp(Context.density,targetContext.density,.12);Context.drive=lerp(Context.drive,targetContext.drive,.15);Context.boombap=lerp(Context.boombap,targetContext.boombap,.16);Context.bright=lerp(Context.bright,targetContext.bright,.10);Context.tension=lerp(Context.tension,targetContext.tension,.065);Context.open=lerp(Context.open,targetContext.open,.05);
 const mix=+document.getElementById('ctxPerf').value,blend=(fast,context,shape)=>{const weight=Math.max(0,Math.min(1,mix*shape));return fast*(1-weight)+context*weight};
 S.energy=blend(Fast.energy,Context.energy,.95);S.density=blend(Fast.density,Context.density,1);S.drive=blend(Fast.drive,Context.drive,.92);S.boombap=Fast.boombap*.8+Context.boombap*.2;S.bright=blend(Fast.bright,Context.bright,1);S.tension=blend(Fast.tension,Context.tension,1.08);S.open=blend(Fast.open,Context.open,1.12);
 const bands=Object.entries(features.bands).map(([name,value])=>{const [low,high]=features.bandRanges[name];return `${name} ${low}–${Math.round(high)} Hz ${value.toFixed(1)}`}).join(' · '),ranges=Object.entries(features.normalization).map(([name,value])=>`${name} ${value.low.toFixed(2)}…${value.high.toFixed(2)}`).join(' · ');
 const diagnostics=document.getElementById('analysisDiagnostics');diagnostics.textContent=`${inputController.context.sampleRate} Hz · ${bands} dBFS · onset ${features.onset.toFixed(3)} · BPM ${BPM?BPM.toFixed(1):'—'} · confidence ${BPMConfidence.toFixed(2)} · phase ${features.tempo.phase.toFixed(2)} · kick ${features.events.kick?'HIT':'—'} · snare ${features.events.snare?'HIT':'—'} · gate ${features.gate?'CLOSED':'OPEN'} · norm ${ranges}`;diagnostics.title=diagnostics.textContent;
}

let current=0,target=0,archMix=0,transitioning=false,mode='smooth',transitionStart=0;
let archetypeSelectionBusy=false,queuedArchetype=null;
let deletingArchetype=false,pendingDeleteArchId=null;
const deleteArchDialog=document.getElementById('deleteArchDialog');
function openDeleteArchetype(id){
 const arch=archetypes.find(item=>item.id===id);if(!arch)return;
 pendingDeleteArchId=id;
 document.getElementById('deleteArchName').textContent=arch.name;
 document.getElementById('deleteArchError').hidden=true;
 deleteArchDialog.showModal();
}
deleteArchDialog.addEventListener('close',()=>{pendingDeleteArchId=null});
deleteArchDialog.addEventListener('cancel',event=>{if(deletingArchetype)event.preventDefault()});
document.getElementById('closeDeleteArchDialog').onclick=()=>{if(!deletingArchetype)deleteArchDialog.close()};
document.getElementById('cancelDeleteArch').onclick=()=>{if(!deletingArchetype)deleteArchDialog.close()};
document.getElementById('confirmDeleteArch').onclick=async()=>{
 const index=idToIndex.get(pendingDeleteArchId);
 if(index==null||deletingArchetype)return;
 const error=document.getElementById('deleteArchError');
 if(archetypeSelectionBusy||seqStates.some(state=>state.loading)){error.textContent='Wait for the current media load or archetype switch to finish, then try again.';error.hidden=false;return}
 const button=document.getElementById('confirmDeleteArch');button.disabled=true;deletingArchetype=true;
 try{
   await flushArchetypeWrites();await repository.deleteArchetype(pendingDeleteArchId);
   const remaining=activeProject.archetypeOrder.filter(id=>id!==pendingDeleteArchId);
   await openProject(activeProject.id,{preferredId:remaining[Math.min(index,remaining.length-1)]||null});
   deleteArchDialog.close();
 }catch(cause){console.error('Unable to delete archetype',cause);error.textContent='Could not complete deletion. Please reload the app before trying again.';error.hidden=false}
 finally{button.disabled=false;deletingArchetype=false}
};
renderPresetControls();
const projectSelect=document.getElementById('projectSelect'),projectPanel=document.getElementById('projectPanel');
const LAST_EXPORTED_KEY='eyes4beat_project_last_exported';
function renderLastExported(){
 let date=null;try{date=JSON.parse(localStorage.getItem(LAST_EXPORTED_KEY)||'{}')[activeProject?.id]}catch{}
 document.getElementById('lastExported').textContent='Last exported: '+(date?new Date(date).toLocaleString():'never');
}
async function updateStorageStatus(){
 const status=document.getElementById('storageStatus'),usage=document.getElementById('storageUsage');
 let persistent=false;
 try{persistent=!!(await navigator.storage?.persist?.())}catch{}
 status.textContent=persistent?'Storage: persistent':'Storage may be cleared by the browser — export your projects regularly';
 status.classList.toggle('storageWarning',!persistent);
 try{const estimate=await navigator.storage?.estimate?.();usage.textContent=estimate?.quota!=null?`Usage: ${((estimate.usage||0)/1048576).toFixed(1)} MB / ${((estimate.quota||0)/1048576).toFixed(1)} MB quota`:'Usage/quota unavailable'}
 catch{usage.textContent='Usage/quota unavailable'}
}
async function refreshProjects(){
 const projects=await repository.listProjects();projectSelect.replaceChildren();
 const summary=document.getElementById('projectSummary');summary.replaceChildren();
 if(!projects.length){const option=document.createElement('option');option.textContent='NO PROJECT';option.value='';projectSelect.appendChild(option)}
 else for(const project of projects){const option=document.createElement('option');option.value=project.id;option.textContent=project.name+(project.ownerEmail&&project.ownerEmail!==repository.email?' · SHARED':'');projectSelect.appendChild(option);const row=document.createElement('p');const ready=await repository.projectReadyOffline(project.id);row.textContent=`${project.name} · ${project.ownerEmail||'local'} · ${(project.visibility||'private').toUpperCase()} · ${ready?'READY OFFLINE':'MEDIA MISSING'}`;summary.appendChild(row)}
 projectSelect.value=activeProject?.id||'';
 renderLastExported();
 document.getElementById('projectEmptyHint').hidden=!!projects.length;
 for(const id of ['renameProject','duplicateProject','deleteProject','exportProject'])document.getElementById(id).disabled=!activeProject;
 const owner=!!activeProject&&activeProject.ownerEmail===repository.email;document.getElementById('deleteProject').hidden=!!activeProject&&!owner;document.getElementById('projectVisibility').hidden=!owner;
 if(activeProject)document.getElementById('projectVisibility').textContent=activeProject.visibility==='shared'?'MAKE PRIVATE':'SHARE';
 const ready=activeProject?await repository.projectReadyOffline(activeProject.id):false,offline=document.getElementById('offlineReady');offline.textContent=activeProject?`Offline readiness: ${ready?'Ready offline':'Media missing'}`:'Offline readiness: no project';offline.className='offlineReady '+(ready?'ready':'missing');
 const accountButton=document.getElementById('accountBtn');accountButton.classList.toggle('offlineReadyHeader',!!activeProject&&ready);accountButton.dataset.tooltip=activeProject?(ready?'Account and sync · ready offline':'Account and sync · media missing'):'Account and sync';
}
async function openProject(projectId,{fromShow=false,preferredId=null}={}){
 if(libraryVersionChanged)throw new Error('Library updated in another tab; reload this page');
 const generation=++projectSwitchGeneration;projectSwitching=true;
 try{
 await flushArchetypeWrites();
 await Promise.all([...pendingMediaLoads]);
 const nextProject=projectId?await repository.getProject(projectId):null;
 if(projectId&&(!nextProject||nextProject.deletedAt))throw new Error('Project not found');
 if(nextProject&&!isShowMode&&repository.online)await repository.hydrateProject(nextProject.id,(done,total)=>{document.getElementById('projectStatus').textContent=`Caching media ${done}/${total}…`}).catch(()=>{});
 const records=nextProject?await repository.listArchetypes(nextProject.id):[];
 const mediaRecords=new Map(),missingArchetypes=new Set();
 for(const record of records)for(const media of record.media){if(!mediaRecords.has(media.mediaId)){
   const saved=await repository.getMedia(media.mediaId);mediaRecords.set(media.mediaId,saved||null);
  }if(!mediaRecords.get(media.mediaId))missingArchetypes.add(record.name)}
 const urls=new Map();for(const [mediaId,saved] of mediaRecords)if(saved)urls.set(mediaId,URL.createObjectURL(saved.blob));
 const runtime=nextProject?buildProjectRuntime(nextProject,records,media=>mediaRecords.get(media.mediaId)?({url:urls.get(media.mediaId),type:media.mime,name:media.name,mediaId:media.mediaId}):null):null;
 if(generation!==projectSwitchGeneration){for(const url of urls.values())URL.revokeObjectURL(url);return}
 for(const role of [0,1])for(const slot of [0,1])releaseTextureMedia(role,slot);
 const oldUrls=new Set(IMAGE_SETS.flat().map(source=>typeof source==='string'?null:source.url).filter(Boolean));oldUrls.forEach(URL.revokeObjectURL);
 archetypes.splice(0,archetypes.length,...(runtime?.archetypes||[]));IMAGE_SETS.splice(0,IMAGE_SETS.length,...(runtime?.IMAGE_SETS||[]));
 defaultRoutingMaps.splice(0,defaultRoutingMaps.length,...(runtime?.defaultRoutingMaps||[]));routingMaps=runtime?.routingMaps||[];
 defaultImageConfigs.splice(0,defaultImageConfigs.length,...(runtime?.defaultImageConfigs||[]));imageConfigs=runtime?.imageConfigs||[];
 musicPresets=runtime?.musicPresets||[];looks=runtime?.looks||[];idToIndex=runtime?.idToIndex||new Map();
 seqStates.splice(0,seqStates.length,...archetypes.map(createSequenceState));
 remoteRoleSignatures.fill('');remoteTransitionSignatures.fill('');remoteRoleTokens[0]++;remoteRoleTokens[1]++;
 activeProject=nextProject;current=target=idToIndex.get(preferredId)??0;archMix=1;transitioning=false;queuedArchetype=null;archetypeSelectionBusy=false;particles=[];
 if(!libraryVersionChanged){const notice=document.getElementById('libraryNotice');notice.hidden=!missingArchetypes.size;
 notice.textContent=missingArchetypes.size?`Missing media in: ${[...missingArchetypes].join(', ')}. Available media will continue playing.`:''}
 if(archetypes.length)await Promise.all([loadArchetypeIntoRole(0,target),loadArchetypeIntoRole(1,target)]);
 if(generation!==projectSwitchGeneration)return;
 if(!fromShow)await repository.setActiveProject(activeProject?.id||null);
 projectLookPresets=activeProject?await repository.listLookPresets(activeProject.id):[];renderProjectLookPresets();
 renderArchetypeBar();renderPresetControls();await refreshProjects();
 if(lookPanel.classList.contains('open')){if(archetypes.length)renderLookEditor();else closeLookEditor()}
 if(document.getElementById('imagePanel').classList.contains('open')){if(archetypes.length)renderImageManager();else closeImageManager()}
 if(document.getElementById('matrixPanel').classList.contains('open')){if(archetypes.length)renderMatrixEditor();else closeMappingMatrix()}
 document.getElementById('lookBtn').disabled=!archetypes.length;document.getElementById('imageMgrBtn').disabled=!archetypes.length;
 document.getElementById('openMatrix').disabled=!archetypes.length;
 document.getElementById('projectStatus').textContent='';
 if(!fromShow)showChannel?.postMessage({type:'library-changed',projectId:activeProject?.id||null});
 }finally{if(generation===projectSwitchGeneration)projectSwitching=false}
}
async function initializeLibrary(){
 if(!isShowMode)updateStorageStatus();
 const projects=await repository.listProjects(),meta=await repository.getMeta();
 const initial=projects.find(project=>project.id===meta.lastActiveProjectId)||projects[0]||null;
 await openProject(initial?.id||null,{fromShow:isShowMode});
 if(!isShowMode)try{document.getElementById('legacySection').hidden=!(await legacyDataAvailable())}catch(error){console.warn('Legacy archive check failed',error)}
 if(!projects.length&&!isShowMode)projectPanel.classList.add('open');
 if(!isShowMode)void repository.initialize().then(async()=>{
   const migrationKey=`eyes4beat_local_migration_${repository.email}`;if(!repository.email||localStorage.getItem(migrationKey))return;
   const legacy=new LocalLibraryRepository('eyes4beat-library');const localProjects=await legacy.listProjects();
   if(!localProjects.length){localStorage.setItem(migrationKey,'empty');await legacy.close();return}
   const upload=confirm(`Upload ${localProjects.length} local project${localProjects.length===1?'':'s'} to your account? The local database will be kept.`);
   localStorage.setItem(migrationKey,upload?'uploading':'skipped');
   if(upload)try{await repository.migrateLocalProjects(legacy);localStorage.setItem(migrationKey,'complete');await repository.sync();location.reload()}catch(error){localStorage.removeItem(migrationKey);document.getElementById('projectStatus').textContent='Local project upload failed: '+error.message}
   await legacy.close();
 }).catch(()=>{});
}
projectSelect.onchange=()=>openProject(projectSelect.value).catch(error=>{console.error(error);document.getElementById('projectStatus').textContent=error.message});
document.getElementById('projectManageBtn').onclick=()=>projectPanel.classList.toggle('open');
document.getElementById('closeProjectPanel').onclick=()=>projectPanel.classList.remove('open');
const projectNameDialog=document.getElementById('projectNameDialog'),projectNameInput=document.getElementById('projectNameInput');
let projectDialogAction='create';
function openProjectDialog(action){
 projectDialogAction=action;const deleting=action==='delete';
 document.getElementById('projectDialogTitle').textContent=action==='create'?'CREATE PROJECT':deleting?'DELETE PROJECT':'RENAME PROJECT';
 document.getElementById('projectDialogLabel').textContent=deleting?`TYPE “${activeProject.name}” TO CONFIRM`:'PROJECT NAME';
 document.getElementById('confirmProjectDialog').textContent=action.toUpperCase();
 document.getElementById('confirmProjectDialog').classList.toggle('dangerBtn',deleting);
 projectNameInput.value=action==='rename'?activeProject.name:'';
 document.getElementById('projectDialogError').textContent='';projectNameDialog.showModal();projectNameInput.focus();
}
document.getElementById('cancelProjectDialog').onclick=()=>projectNameDialog.close();
document.getElementById('closeProjectDialog').onclick=()=>projectNameDialog.close();
document.getElementById('projectNameForm').onsubmit=async event=>{
 event.preventDefault();const name=projectNameInput.value.trim(),button=document.getElementById('confirmProjectDialog');
 if(projectDialogAction==='delete'&&name!==activeProject.name){document.getElementById('projectDialogError').textContent='The name does not match.';return}
 button.disabled=true;
 try{
  if(projectDialogAction==='create'){const project=await repository.createProject(name);await openProject(project.id);projectPanel.classList.remove('open')}
  else if(projectDialogAction==='rename'){activeProject=await repository.updateProject(activeProject.id,{name});await refreshProjects()}
  else{await flushArchetypeWrites();await repository.deleteProject(activeProject.id);const remaining=await repository.listProjects();await openProject(remaining[0]?.id||null);if(!remaining.length)projectPanel.classList.add('open')}
  projectNameDialog.close();
 }catch(error){document.getElementById('projectDialogError').textContent=error.message}
 finally{button.disabled=false}
};
document.getElementById('createProject').onclick=()=>openProjectDialog('create');
document.getElementById('renameProject').onclick=()=>{if(activeProject)openProjectDialog('rename')};
document.getElementById('duplicateProject').onclick=async()=>{
 if(!activeProject)return;try{const project=await repository.duplicateProject(activeProject.id);await openProject(project.id);projectPanel.classList.remove('open')}
 catch(error){document.getElementById('projectStatus').textContent=error.message}
};
document.getElementById('deleteProject').onclick=()=>{if(activeProject)openProjectDialog('delete')};
document.getElementById('projectVisibility').onclick=async()=>{if(!activeProject)return;try{activeProject=await repository.setProjectVisibility(activeProject.id,activeProject.visibility==='shared'?'private':'shared');await repository.sync();await refreshProjects()}catch(error){document.getElementById('projectStatus').textContent=error.message}};
document.getElementById('accountBtn').onclick=()=>projectPanel.classList.toggle('open');
document.getElementById('syncNow').onclick=()=>repository.sync().catch(error=>{document.getElementById('projectStatus').textContent=error.message});
document.getElementById('signOut').onclick=()=>{location.href='/cdn-cgi/access/logout'};
document.getElementById('liveLockBtn').onclick=()=>repository.setLiveLock(!repository.state.liveLock).catch(console.error);
addEventListener('focus',()=>{if(!isShowMode)void repository.sync().catch(()=>{})});
document.addEventListener('visibilitychange',()=>{if(!isShowMode&&document.visibilityState==='visible')void repository.sync().catch(()=>{})});
function renderArchetypeBar(){
 const bar=document.getElementById('archBar');bar.innerHTML='';
 if(!archetypes.length){const empty=document.createElement('span');empty.className='archEmpty';empty.textContent=activeProject?'No archetypes yet — create one or import a package.':'Create or import a project to begin.';bar.appendChild(empty)}
 archetypes.forEach((arch,index)=>{
   const button=document.createElement('button');button.className='arch'+(index===target?' active':'');button.dataset.a=String(index);
   const origin=arch.origin?.type||'blank',subtitle=origin==='factory'?(FACTORY_LOOKS.find(preset=>preset.id===arch.origin.presetId)?.subtitle||'factory look'):origin==='project-preset'?'project look preset':origin==='import'?'imported':'blank look';
   button.innerHTML='<b></b><span></span>';button.querySelector('b').textContent=(index+1)+' · '+arch.name;button.querySelector('span').textContent=subtitle;button.onclick=()=>selectArchetype(index);
   const item=document.createElement('div');item.className='archItem';item.appendChild(button);
   const actions=[['pencil','Rename archetype',async()=>{const name=await askLibraryAction({title:'RENAME ARCHETYPE',value:arch.name,confirm:'RENAME'});if(!name)return;await repository.updateArchetype(arch.id,{name});arch.name=name;renderArchetypeBar();if(lookPanel.classList.contains('open'))renderLookEditor()}],
    ['copy','Duplicate archetype',async()=>{await flushArchetypeWrites();const duplicate=await repository.duplicateArchetype(arch.id);await openProject(activeProject.id,{preferredId:duplicate.id})}],
    ['chevron-left','Move archetype earlier',async()=>{if(index===0)return;const order=[...activeProject.archetypeOrder];[order[index-1],order[index]]=[order[index],order[index-1]];await repository.reorderArchetypes(activeProject.id,order);await openProject(activeProject.id,{preferredId:arch.id})}],
    ['chevron-right','Move archetype later',async()=>{if(index===archetypes.length-1)return;const order=[...activeProject.archetypeOrder];[order[index],order[index+1]]=[order[index+1],order[index]];await repository.reorderArchetypes(activeProject.id,order);await openProject(activeProject.id,{preferredId:arch.id})}],
    ['trash-2','Delete archetype',()=>openDeleteArchetype(arch.id)]];
   const toolbar=document.createElement('div');toolbar.className='archToolbar';for(const [glyph,label,action] of actions){const control=document.createElement('button');control.type='button';control.className='iconAction';control.innerHTML=icon(glyph);control.setAttribute('aria-label',label+' '+arch.name);control.dataset.tooltip=label;control.onclick=()=>Promise.resolve(action()).catch(error=>{console.error(error);alert(error.message)});toolbar.appendChild(control)}item.appendChild(toolbar);bar.appendChild(item);
 });
 const createButton=document.createElement('button');createButton.id='archetypeCreatorBtn';createButton.className='createArchFooter';createButton.title='Create a new archetype';createButton.setAttribute('aria-label','Create archetype');createButton.innerHTML='<b>'+icon('plus')+' CREATE ARCHETYPE</b><span>add your image sequence</span>';createButton.onclick=()=>activeProject?openArchetypeCreator():projectPanel.classList.add('open');bar.appendChild(createButton);
 const verifyButton=document.createElement('button');verifyButton.className='libraryFooter';verifyButton.innerHTML=icon('file-check-2')+' VERIFY PACKAGE';verifyButton.title='Verify library package without importing it';verifyButton.onclick=()=>document.getElementById('verifyPackageFile').click();bar.appendChild(verifyButton);
}
const packageDialog=document.createElement('dialog');packageDialog.className='packageDialog';packageDialog.innerHTML='<div class="packageDialogHead"><h2>LIBRARY PACKAGE</h2><button type="button" class="iconAction closeAction" aria-label="Close package report" data-tooltip="Close package report">'+icon('x')+'</button></div><p id="packageMessage"></p><progress id="packageProgress" max="1" value="0" hidden></progress><pre id="packageReport"></pre><div id="packageConfirmation" hidden><button type="button" id="packageContinue">CONTINUE EXPORT</button><button type="button" id="packageCancel">CANCEL</button></div>';document.body.appendChild(packageDialog);
packageDialog.querySelector('.closeAction').onclick=()=>packageDialog.close();
packageDialog.querySelector('#packageCancel').onclick=()=>packageDialog.close();
const verifyPackageFile=document.createElement('input');verifyPackageFile.id='verifyPackageFile';verifyPackageFile.type='file';verifyPackageFile.accept='.zip,application/zip';document.body.appendChild(verifyPackageFile);
function packageStatus(message,progress=null,report=''){
 packageDialog.querySelector('#packageMessage').textContent=message;
 const meter=packageDialog.querySelector('#packageProgress');meter.hidden=!progress;if(progress){meter.max=progress.total||1;meter.value=progress.done}
 packageDialog.querySelector('#packageReport').textContent=report;
 if(!packageDialog.open)packageDialog.showModal();
}
function localStorageBackup(){
 const values={};for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key.startsWith('arv_')||key.startsWith('eyes4beat'))values[key]=localStorage.getItem(key)}return values;
}
function libraryFilename(date=new Date()){
 const digits=value=>String(value).padStart(2,'0');return `eyes4beat-library-${date.getFullYear()}${digits(date.getMonth()+1)}${digits(date.getDate())}-${digits(date.getHours())}${digits(date.getMinutes())}.zip`;
}
async function exportPackage(snapshot,{kind='legacy-library',project=null,lookPresets=[],button=null}={}){
 if(button)button.disabled=true;
 try{
  packageStatus('Checking library size…');
  let estimated=0,sizeUnknown=false;
  for(const arch of snapshot)for(const item of arch.media){
   if(item.blob)estimated+=item.blob.size;
   else try{const response=await fetch(item.url,{method:'HEAD'});const length=Number(response.headers.get('content-length'));if(response.ok&&length>0)estimated+=length;else sizeUnknown=true}catch{sizeUnknown=true}
  }
  if(estimated>1024**3||sizeUnknown){
   packageStatus(sizeUnknown?`Some media sizes could not be estimated${estimated?`; at least ${(estimated/1024**3).toFixed(2)} GB is known`:''}. Exporting may require substantial memory and disk space. Continue?`:
    `This library contains at least ${(estimated/1024**3).toFixed(2)} GB of media. Exporting may require substantial memory and disk space. Continue?`);
   const controls=packageDialog.querySelector('#packageConfirmation');controls.hidden=false;
   const approved=await new Promise(resolve=>{packageDialog.querySelector('#packageContinue').onclick=()=>resolve(true);packageDialog.querySelector('#packageCancel').onclick=()=>resolve(false);packageDialog.addEventListener('close',()=>resolve(false),{once:true})});
   controls.hidden=true;if(!approved)return;
  }
  const total=snapshot.reduce((sum,arch)=>sum+arch.media.length,0);let loaded=0;
  for(const arch of snapshot)for(const item of arch.media){
   packageStatus(`Reading media ${loaded+1} of ${total}…`,{done:loaded,total});
   await new Promise(resolve=>requestAnimationFrame(resolve));
   const blob=item.blob||await (async()=>{const response=await fetch(item.url);if(!response.ok)throw new Error(`Cannot fetch ${item.name}: HTTP ${response.status}`);return response.blob()})();
   item.mime=item.mime||blob.type||'application/octet-stream';item.bytes=new Uint8Array(await blob.arrayBuffer());delete item.blob;delete item.url;loaded++;
  }
  packageStatus('Packing and checking media…',{done:0,total});
  const result=await buildLibraryPackage({archetypes:snapshot,localStorage:kind==='legacy-library'?localStorageBackup():{},appVersion:packageInfo.version,userAgent:navigator.userAgent,kind,project,lookPresets},async(done,count)=>{packageStatus(`Hashing media ${done} of ${count}…`,{done,total:count});await new Promise(resolve=>requestAnimationFrame(resolve))});
  const blob=new Blob([result.zip],{type:'application/zip'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=kind==='project'?libraryFilename().replace('library','project'):libraryFilename();document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  if(kind==='project'&&project?.id){try{const dates=JSON.parse(localStorage.getItem(LAST_EXPORTED_KEY)||'{}');dates[project.id]=new Date().toISOString();localStorage.setItem(LAST_EXPORTED_KEY,JSON.stringify(dates));renderLastExported()}catch(error){console.warn('Could not save last export date',error)}}
  packageStatus('Export complete.',null,`${result.manifest.archetypes.length} archetypes · ${result.uniqueMediaCount} unique media files · ${(blob.size/1024/1024).toFixed(1)} MB package`);
 }catch(error){console.error('Library export failed',error);packageStatus('Export failed.',null,error.message||String(error))}
 finally{if(button)button.disabled=false}
}
document.getElementById('exportLegacy').onclick=async event=>exportPackage(await collectLegacyLibrary(),{button:event.currentTarget});
document.getElementById('exportBuiltins').onclick=async event=>exportPackage(await collectLegacyLibrary({builtinsOnly:true}),{button:event.currentTarget});
document.getElementById('exportProject').onclick=async event=>{
 if(!activeProject)return;
 try{
  await flushArchetypeWrites();
  const records=new Map((await repository.listArchetypes(activeProject.id)).map(record=>[record.id,record]));
  const snapshot=[];for(const id of activeProject.archetypeOrder){const record=records.get(id);if(!record)continue;
    const media=[];for(const [sourceIndex,ref] of record.media.entries()){const saved=await repository.getMedia(ref.mediaId);if(!saved)throw new Error(`Cannot export ${record.name}: missing media ${ref.name}`);media.push({...ref,sourceIndex,blob:saved.blob})}
    snapshot.push({id:record.id,name:record.name,origin:record.origin,look:record.look,routingMap:record.routingMap,imageConfig:record.imageConfig,musicPresets:record.musicPresets,media});
  }
  await exportPackage(snapshot,{kind:'project',project:activeProject,lookPresets:projectLookPresets,button:event.currentTarget});
 }catch(error){console.error('Project export failed',error);packageStatus('Project export unavailable.',null,error.message||String(error))}
};
verifyPackageFile.onchange=async()=>{
 const file=verifyPackageFile.files?.[0];verifyPackageFile.value='';if(!file)return;
 try{
  packageStatus('Verifying package…');
  const report=await verifyLibraryPackage(new Uint8Array(await file.arrayBuffer()));
  packageStatus(report.valid?'Package verified: no errors.':'Package verification found problems.',null,
   `Format version: ${report.formatVersion}${report.supported?'':' (unsupported)'}\nArchetypes: ${report.archetypeCount}\nMedia files: ${report.mediaCount}\nMissing files: ${report.missingFiles.length}${report.missingFiles.length?'\n'+report.missingFiles.join('\n'):''}\nChecksum mismatches: ${report.checksumMismatches.length}${report.checksumMismatches.length?'\n'+report.checksumMismatches.join('\n'):''}\nInvalid entries: ${report.invalidEntries.length}${report.invalidEntries.length?'\n'+report.invalidEntries.join('\n'):''}`);
 }catch(error){console.error('Package verification failed',error);packageStatus('Could not verify package.',null,error.message||String(error))}
};
document.getElementById('importPackage').onclick=()=>document.getElementById('importPackageFile').click();
document.getElementById('importPackageFile').onchange=async event=>{
 const file=event.target.files?.[0];event.target.value='';if(!file)return;
 try{
  const zip=new Uint8Array(await file.arrayBuffer()),report=await verifyLibraryPackage(zip);
  if(!report.valid)throw new Error(`Package validation failed: ${report.missingFiles.length} missing, ${report.checksumMismatches.length} corrupt, ${report.invalidEntries.length} invalid entries.`);
  const {manifest,files}=readPackage(zip),projects=await repository.listProjects();
  const dialog=document.createElement('dialog');dialog.className='packageDialog importDialog';
  const heading=document.createElement('div');heading.className='packageDialogHead';const title=document.createElement('h2');title.textContent=`IMPORT · ${manifest.archetypes.length} ARCHETYPES`;heading.appendChild(title);
  const close=document.createElement('button');close.type='button';close.className='iconAction closeAction';close.innerHTML=icon('x');close.setAttribute('aria-label','Close import');close.dataset.tooltip='Close import';close.onclick=()=>dialog.close();heading.appendChild(close);dialog.appendChild(heading);
  const destination=document.createElement('select');destination.setAttribute('aria-label','Import destination project');
  const newOption=document.createElement('option');newOption.value='';newOption.textContent='New project';destination.appendChild(newOption);
  projects.forEach(project=>{const option=document.createElement('option');option.value=project.id;option.textContent=project.name;destination.appendChild(option)});dialog.appendChild(destination);
  const name=document.createElement('input');name.type='text';name.value=manifest.kind==='project'?manifest.project.name:file.name.replace(/\.zip$/i,'');name.placeholder='New project name';name.setAttribute('aria-label','New project name');dialog.appendChild(name);
  destination.onchange=()=>{name.hidden=!!destination.value};
  const list=document.createElement('div');list.className='importChoices';const boxes=[];
  manifest.archetypes.forEach((arch,index)=>{const row=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.checked=true;boxes.push(box);row.append(box,document.createTextNode(`${index+1}. ${arch.name} · ${arch.media.length} media`));list.appendChild(row)});dialog.appendChild(list);
  const status=document.createElement('p');status.setAttribute('role','status');dialog.appendChild(status);
  const controls=document.createElement('div');controls.className='dialogActions';
  const cancel=document.createElement('button');cancel.textContent='CANCEL';cancel.onclick=()=>dialog.close();
  const apply=document.createElement('button');apply.textContent='IMPORT SELECTED';controls.append(cancel,apply);dialog.appendChild(controls);document.body.appendChild(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
  apply.onclick=async()=>{
   const selected=manifest.archetypes.filter((_,index)=>boxes[index].checked);
   if(!selected.length){status.textContent='Select at least one archetype.';return}
   if(!destination.value&&!name.value.trim()){status.textContent='Enter a project name.';return}
   apply.disabled=true;
   let imported=false;
   try{
    const preparedEntries=[];
    for(const [index,source] of selected.entries()){
      status.textContent=`Preparing ${index+1} of ${selected.length}: ${source.name}`;
      const prepared=prepareImportedArchetype(source,manifest.formatVersion);
      prepared.media=prepared.media.map(ref=>({name:ref.name,mime:ref.mime,blob:new Blob([files[ref.path]],{type:ref.mime})}));
      preparedEntries.push(prepared);
    }
    status.textContent='Saving package atomically…';
    const {project}=await repository.importBatch({projectId:destination.value||null,projectName:name.value.trim(),archetypes:preparedEntries,
      lookPresets:manifest.kind==='project'?manifest.lookPresets.map(preset=>({name:preset.name,look:normalizeLook(preset.look)})):[]});
    imported=true;
    dialog.close();projectPanel.classList.remove('open');await openProject(project.id);
   }catch(error){console.error('Import failed',error);status.textContent=imported?`Import saved, but opening failed: ${error.message}`:`Import stopped: ${error.message}. No partial import was saved.`;apply.disabled=false}
  };
 }catch(error){console.error('Package validation failed',error);document.getElementById('projectStatus').textContent=error.message}
};
async function selectArchetype(a){
 if(!Number.isInteger(a)||a<0||a>=archetypes.length)return;
 if(remoteRefreshPending){const wanted=archetypes[a]?.id;remoteRefreshPending=false;await openProject(activeProject.id,{preferredId:wanted});return}
 if(projectSwitching||deletingArchetype)return;
 if(a===target)return;
 if(archetypeSelectionBusy){queuedArchetype=a;return}
 archetypeSelectionBusy=true;
 const previous=target;
 try{
   await Promise.all([loadArchetypeIntoRole(0,previous),loadArchetypeIntoRole(1,a)]);
   if(projectSwitching)return;
   current=previous;target=a;
   document.querySelectorAll('.arch').forEach(x=>x.classList.toggle('active',+x.dataset.a===a));
   if(mode==='cut'||panicActive){current=target;archMix=1;transitioning=false}
   else{transitioning=true;archMix=0;transitionStart=performance.now()}
   renderPresetControls();
   if(document.getElementById('matrixPanel').classList.contains('open'))renderMatrixEditor();
   if(document.getElementById('imagePanel').classList.contains('open'))renderImageManager();
   if(lookPanel.classList.contains('open'))renderLookEditor();
 }finally{
   archetypeSelectionBusy=false;
   const queued=queuedArchetype;queuedArchetype=null;
   if(queued!=null&&queued!==target)selectArchetype(queued);
 }
}
const archBarToggle=document.getElementById('archBarToggle'),uiRoot=document.querySelector('.ui'),archBar=document.getElementById('archBar');
function updateFooterMetrics(){uiRoot.style.setProperty('--footer-height',`${Math.ceil(archBar.getBoundingClientRect().height)}px`)}
new ResizeObserver(updateFooterMetrics).observe(archBar);updateFooterMetrics();
function setArchetypeBarCollapsed(collapsed){
 uiRoot.classList.toggle('footerCollapsed',collapsed);
 archBarToggle.setAttribute('aria-expanded',String(!collapsed));archBarToggle.classList.toggle('collapsed',collapsed);
 archBarToggle.querySelector('span').textContent=collapsed?'ARCHETYPES':'HIDE ARCHETYPES';
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
 if(action.type==='live-lock'){void repository.setLiveLock(!repository.state.liveLock);showShortcutToast('LIVE LOCK · '+(!repository.state.liveLock?'ON':'OFF'));return}
 if(action.type==='safety'){
   const active=action.control==='blackout'?toggleBlackout():togglePanic();
   showShortcutToast(action.control.toUpperCase()+' · '+(active?'ON':'OFF'));return;
 }
 if(action.type==='transition'){setTransitionMode(action.mode);showShortcutToast(action.mode.toUpperCase()+' TRANSITIONS');return}
 if(action.type==='preset-select'){activatePreset(action.index);return}
 if(action.type==='preset-step'){stepPreset(action.direction);return}
 if(action.type==='media-step'){
   requestImageChange(target,chooseOrderedImage(target,action.direction),'manual');showShortcutToast(action.direction>0?'NEXT MEDIA':'PREVIOUS MEDIA');return;
 }
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
function updateParticles(t,look){
 const settings=look.particles;
 const partAmt=FinalG.parts;
 const wanted=Math.floor(150*settings.density*partAmt);
 while(particles.length<wanted) particles.push({x:Math.random()*innerWidth,y:Math.random()*innerHeight,z:Math.random(),r:.6+Math.random()*2.3,vx:(Math.random()-.5),vy:(Math.random()-.5),life:Math.random()*100});
 while(particles.length>wanted)particles.pop();
 ctx.clearRect(0,0,pcanvas.width,pcanvas.height);
 ctx.globalCompositeOperation='screen';
 const speed=particleSpeed(look,partAmt),[red,green,blue]=hexRgb(settings.color);
 for(let index=0;index<particles.length;index++){
   const p=stepParticle(particles[index],look,t,innerWidth,innerHeight,partAmt);particles[index]=p;
   let alpha=(.08+.34*p.z)*clamp(partAmt,0,1.4);
   ctx.fillStyle=`rgba(${red},${green},${blue},${alpha})`;
   ctx.strokeStyle=`rgba(${red},${green},${blue},${alpha})`;
   ctx.lineWidth=.6+p.z;
   if(settings.style==='streaks'){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-(8+18*p.z)*speed,p.y+settings.streakSlant);ctx.stroke()}
   else if(settings.style==='rings'){ctx.beginPath();ctx.arc(p.x,p.y,p.r*(1.5+p.z*2),0,Math.PI*2);ctx.stroke()}
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
 if(!archetypes.length){
   if(!isShowMode){if(showChannel&&now-lastShowBroadcastAt>=40){lastShowBroadcastAt=now;showChannel.postMessage({type:'frame',state:{projectId:activeProject?.id||null,currentId:null,targetId:null,blackout:blackoutActive,finalG:{...NEUTRAL_TARGETS}}})}}
   else if(remoteVisualState)setBlackout(!!remoteVisualState.blackout);
   gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);ctx.clearRect(0,0,pcanvas.width,pcanvas.height);
   requestAnimationFrame(frame);return;
 }
 let Eff;
 if(isShowMode){
   if(remoteVisualState){applyRemoteVisualState(remoteVisualState);BPM=remoteVisualState.bpm||0;BeatPulse=remoteVisualState.beat||0;KickFast=remoteVisualState.kick||0;SnareFast=remoteVisualState.snare||0}
   if(current!==target&&seqStates[current]?.transitioning)advanceSequenceTransition(0,current,now);
   if(seqStates[target]?.transitioning)advanceSequenceTransition(1,target,now);
   Eff=remoteVisualState?.eff||neutralVals;
 }else{
   // The render loop consumes the latest fixed-hop AudioWorklet features.
   Eff=getEffectiveState();
   const routedTargets=computeGlobalMapping(Eff,now);
   FinalG=applyPanicTargets(routedTargets,{panic:panicActive,releaseStartedAt:panicReleaseStartedAt,now,duration:300});
   if(panicReleaseStartedAt!=null&&now-panicReleaseStartedAt>=300)panicReleaseStartedAt=null;
   routeTargets.forEach(key=>{document.getElementById('gf-'+key).textContent=FinalG[key].toFixed(2)});
   if(transitioning&&current!==target&&seqStates[current]?.transitioning)advanceSequenceTransition(0,current,now);
   if(!projectSwitching)updateImageSequence(now,Eff,panicActive);
   if(transitioning){
     let x=Math.min(1,(now-transitionStart)/6500);archMix=smoothstep(x);
     if(x>=1){current=target;archMix=1;transitioning=false}
   }
   broadcastShowFrame(now,Eff);
 }
 gl.useProgram(prog);
 gl.uniform2f(U.uRes,canvas.width,canvas.height);
 gl.uniform1f(U.uTime,(now-t0)/1000);
 const sequenceA=seqStates[current],sequenceB=seqStates[target];
 const lookA=isShowMode&&remoteVisualState?.lookA?remoteVisualState.lookA:looks[current];
 const lookB=isShowMode&&remoteVisualState?.lookB?remoteVisualState.lookB:looks[target];
 const uniformsA=lookUniforms(lookA),uniformsB=lookUniforms(lookB);
 gl.uniform1f(U.uMorphA,sequenceA.blend);gl.uniform1f(U.uMorphB,sequenceB.blend);
 gl.uniform1i(U.uTransA,sequenceA.transitionShaderId);gl.uniform1i(U.uTransB,sequenceB.transitionShaderId);
 gl.uniform1f(U.uSeedA,sequenceA.seed);gl.uniform1f(U.uSeedB,sequenceB.seed);
 gl.uniform4fv(U.uParamA,sequenceA.param);gl.uniform4fv(U.uParamB,sequenceB.param);
 gl.uniform1f(U.uArchMix,transitioning?archMix:1);
 gl.uniform4fv(U.uWarpA,uniformsA.warp);gl.uniform4fv(U.uWarpB,uniformsB.warp);
 gl.uniform2fv(U.uWarpDirA,uniformsA.direction);gl.uniform2fv(U.uWarpDirB,uniformsB.direction);
 gl.uniform4fv(U.uGradeA,uniformsA.grade);gl.uniform4fv(U.uGradeB,uniformsB.grade);
 gl.uniform1f(U.uMapPulse,FinalG.pulse);
 gl.uniform1f(U.uDistAmt,FinalG.dist);gl.uniform1f(U.uGlowAmt,FinalG.glow);gl.uniform1f(U.uLumAmt,FinalG.luma);gl.uniform1f(U.uSatAmt,FinalG.sat);gl.uniform1f(U.uZoomAmt,FinalG.zoom);
 gl.uniform1f(U.uRotateAmt,FinalG.rotate);gl.uniform1f(U.uSpiralAmt,FinalG.spiral);gl.uniform1f(U.uTilesAmt,FinalG.tiles);
 refreshVideoTextures();
 gl.drawArrays(gl.TRIANGLES,0,3);
 updateParticles(now,lookB);
 const vals=[['E',Eff.energy],['D',Eff.density],['R',Eff.drive],['K',Eff.boombap],['T',Eff.tension],['B',Eff.bright],['O',Eff.open]];
 vals.forEach(([k,v])=>{document.getElementById('v'+k).textContent=v.toFixed(2);document.getElementById('f'+k).style.width=(v*100)+'%'});
 document.getElementById('vBeat').textContent=BeatPulse.toFixed(2);
 document.getElementById('fBeat').style.width=(Math.min(1,BeatPulse)*100)+'%';
 document.getElementById('vKick').textContent=KickFast.toFixed(2);document.getElementById('fKick').style.width=(Math.min(1,KickFast)*100)+'%';
 document.getElementById('vSnare').textContent=SnareFast.toFixed(2);document.getElementById('fSnare').style.width=(Math.min(1,SnareFast)*100)+'%';
 document.getElementById('vBPM').textContent=BPM>0?Math.round(BPM):'--';
 document.getElementById('fBpmConf').style.width=(BPMConfidence*100)+'%';
 const zoomLevel=Math.max(0,Math.min(1,(FinalG.zoom-.9)/.28));document.getElementById('vZoom').textContent=FinalG.zoom.toFixed(2);document.getElementById('fZoom').style.width=(zoomLevel*100)+'%';
 requestAnimationFrame(frame);
}
await initializeLibrary();
start();
