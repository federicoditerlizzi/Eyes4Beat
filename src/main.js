import { createPresetMenu } from './ui/preset-menu.js';
import { createProjectUi } from './ui/project-ui.js';
import { renderLookControls, updateLookRoutingHints, startingLook } from './ui/look-editor.js';
import { createWorkspaceLayout } from './ui/workspace-layout.js';
import './styles.css';
import { renderEngineState } from './ui/engine-view.js';
import { createVisualEngine } from './engine/engine.js';
import { EngineSession } from './engine/engine-session.js';
import { createOutputController } from './ui/output-controller.js';
import { LocalTransport } from './engine/local-transport.js';
import { routeSources, routeTargets, sourceLabels, eventSourceIds, targetLabels, blankMap } from './config.js';
import { assignedSource, assignTarget } from './routing.js';
import { collectLegacyLibrary, legacyDataAvailable } from './legacy/export.js';
import { SyncedLibraryRepository } from './library/synced-repository.js';
import { LocalLibraryRepository } from './library/local-repository.js';
import { buildProjectRuntime, defaultImageConfig, normalizeRoutingMap } from './library/runtime.js';
import { resolvePerformanceShortcut } from './shortcuts.js';
import { INPUT_DEVICE_KEY } from './audio-input.js';
import { icon, initIcons } from './icons.js';
import { buildLibraryPackage, readPackage, verifyLibraryPackage } from './package-format.js';
import { prepareImportedArchetype } from './library/package-mapping.js';
import { FACTORY_LOOKS, NEUTRAL_LOOK, normalizeLook } from './looks.js';
import packageInfo from '../package.json';
import { EASINGS, TRANSITIONS, WIPE_DIRECTIONS } from './transitions.js';
import { DWELL_BEAT_OPTIONS, IMAGE_TRIGGER_CLASSES, TRANSITION_BEAT_OPTIONS } from './image-sequencer.js';

let projectUi=null;
let engineState=null,adoptingOutput=false,discoveringOutput=true;
const transport=new EngineSession(()=>new LocalTransport(createVisualEngine,{canvas:document.getElementById('gl'),particleCanvas:document.getElementById('particles'),blackoutOverlay:document.getElementById('blackoutOverlay')}));
function send(type,payload={}){return transport.send(type,payload).catch(error=>{const notice=document.getElementById('outputNotice');notice.hidden=false;document.getElementById('outputMessage').textContent=error.message;throw error})}
function fire(type,payload={}){void send(type,payload).catch(error=>console.error('Engine command failed',error))}

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
let blackoutActive=false,panicActive=false;

let libraryVersionChanged=false,syncReloadTimer=null,lastConflictKey=null,remoteRefreshPending=false;
function renderSyncState(state){
 const status=document.getElementById('syncStatus');if(!status)return;
 void projectUi?.updateSync();
 document.getElementById('accountEmail').textContent=state.email||'Offline cache';status.textContent=state.status.toUpperCase().replace('-',' ');
 document.getElementById('syncLast').textContent='Last sync: '+(state.lastSync?new Date(state.lastSync).toLocaleString():'never');
 if(state.status==='session-expired'){const notice=document.getElementById('libraryNotice');notice.textContent='Session expired — reload to sign in. Cached projects remain available.';notice.hidden=false}
 if(!discoveringOutput&&!adoptingOutput&&!transport.transport.recovery)fire('setSafety',{control:'liveLock',value:!!state.liveLock});
 const lock=document.getElementById('liveLockBtn'),badge=document.getElementById('liveLockBadge');lock.setAttribute('aria-pressed',String(state.liveLock));badge.hidden=!state.liveLock;badge.querySelector('span').textContent=String(state.pending||0);
 if(state.conflict){lastConflictKey=state.conflict.key;const notice=document.getElementById('libraryNotice');notice.replaceChildren(document.createTextNode(`${state.conflict.name} was changed by ${state.conflict.updatedBy||'another user'}. `));notice.hidden=false;const button=document.createElement('button');button.textContent='RESTORE MY VERSION';button.onclick=()=>repository.restoreConflict(lastConflictKey).catch(console.error);notice.appendChild(button)}
}
function onSyncedLibraryChanged(change={}){
 if(change.userChanged){clearTimeout(syncReloadTimer);syncReloadTimer=setTimeout(()=>location.reload(),50);return}
 if(change.deferredApplied){remoteRefreshPending=true;return}
 if(transport.transport.recovery){remoteRefreshPending=true;return}
 if(projectSwitching)return;clearTimeout(syncReloadTimer);syncReloadTimer=setTimeout(async()=>{const projects=await repository.listProjects(),wanted=activeProject&&projects.some(item=>item.id===activeProject.id)?activeProject.id:projects[0]?.id||null;await openProject(wanted,{preferredId:archetypes[target]?.id})},250);
}
const repository=new SyncedLibraryRepository({ onState:renderSyncState, onLibraryChanged:onSyncedLibraryChanged });
window.EyesForBeatsSync={sync:()=>repository.sync(),setLiveLock:value=>setLiveLock(value),toggleLiveLock:()=>setLiveLock(!repository.state.liveLock)};
let activeProject=null,projectLookPresets=[],idToIndex=new Map();
let projectSwitching=false,projectSwitchGeneration=0;
const archetypes=[],IMAGE_SETS=[],defaultRoutingMaps=[];
let looks=[];
const pendingWrites=new Map(),failedWrites=new Map();
let writeQueue=Promise.resolve();
function queueArchetypeWrite(index,changes){
 const id=archetypes[index]?.id;if(!id)return;
 fire('updateArchetype',{id,patch:changes});
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
 lookPreset.replaceChildren();
 const add=(value,name,group,managed=false)=>{const option=document.createElement('option');option.value=value;option.textContent=name;option.dataset.group=group;option.dataset.managed=String(managed);lookPreset.append(option)};
 add('','Select a look…','');
 FACTORY_LOOKS.forEach(preset=>add('factory:'+preset.id,preset.name,'Factory looks'));
 add('blank','Blank','Blank');
 projectLookPresets.forEach(preset=>add('project:'+preset.id,preset.name,'Project presets',true));
 lookPreset.presetMenu?.refresh();
}
async function manageLookPreset(value,remove=false){
 const preset=projectLookPresets.find(p=>'project:'+p.id===value);if(!preset)return;
 const projectId=activeProject.id;
 if(remove){if(!await askLibraryAction({title:'DELETE LOOK PRESET',message:`Delete “${preset.name}” from this project?`,confirm:'DELETE',requireInput:false}))return;await repository.deleteLookPreset(preset.id)}
 else{const name=await askLibraryAction({title:'RENAME LOOK PRESET',value:preset.name,confirm:'RENAME'});if(!name)return;await repository.updateLookPreset(preset.id,{name})}
 if(activeProject?.id===projectId){projectLookPresets=await repository.listLookPresets(projectId);renderProjectLookPresets()}
}
createPresetMenu(lookPreset,{label:'Look presets',onRename:value=>manageLookPreset(value),onDelete:value=>manageLookPreset(value,true)});
function closeLookEditor(){lookPanel.classList.remove('open')}
function updateLookRoutingWarning(){
 const map=routingMaps[target],empty=routeSources.every(source=>routeTargets.every(key=>!Number(map?.[source]?.[key])));
 document.getElementById('lookRoutingWarning').hidden=!empty;
 updateLookRoutingHints(document.getElementById('lookFields'),map);
}
function renderLookEditor(){
 const root=document.getElementById('lookFields'),arch=archetypes[target];
 renderLookControls({root,getLook:()=>looks[target],onChange:look=>{looks[target]=look;saveLooks()},
  start:startingLook({...arch,look:looks[target]},projectLookPresets,localStorage,repository.cache.name),map:routingMaps[target],openRouting:()=>document.getElementById('routingTab').click()});
 lookPreset.value='';lookPreset.presetMenu.refresh();updateLookRoutingWarning();
}
document.getElementById('lookBtn').onclick=()=>{closeImageManager();closeRouting();closeArchetypeCreator();renderLookEditor();lookPanel.classList.add('open')};
lookPreset.onchange=async()=>{
 const value=lookPreset.value;if(!value)return;
 const factory=FACTORY_LOOKS.find(preset=>value==='factory:'+preset.id),projectPreset=projectLookPresets.find(preset=>value==='project:'+preset.id);
 const label=value==='blank'?'Blank':factory?.name||projectPreset?.name;if(!label){lookPreset.value='';lookPreset.presetMenu.refresh();return}
 if(!await askLibraryAction({title:'REPLACE LOOK',message:`Replace ${archetypes[target].name}'s current look with ${label}? This cannot be undone.`,confirm:'REPLACE',requireInput:false})){lookPreset.value='';lookPreset.presetMenu.refresh();return}
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
function refreshRoutingSources(){
 for(const t of routeTargets){
  const row=document.querySelector('[data-target-on="'+t+'"]').closest('.gRow');
  let select=row.querySelector('.targetSource');
  if(!select){
   select=document.createElement('select');select.className='targetSource';select.dataset.targetSource=t;
   select.setAttribute('aria-label','Source for '+targetLabels[t]);
   select.innerHTML='<option value="">None</option>'+routeSources.map(id=>'<option value="'+id+'">'+sourceLabels[id]+'</option>').join('');
   row.children[0].after(select);
   select.onchange=()=>{
    const map=routingMaps[target],previous=assignedSource(map,t),weight=previous?map[previous][t]:1;
    assignTarget(map,t,select.value,weight);saveRoutingMaps();
   };
  }
  select.value=assignedSource(routingMaps[target],t)||'';
 }
}
function closeRouting(){document.getElementById('routingPanel').classList.remove('open')}
document.getElementById('routingTab').onclick=()=>{closeImageManager();closeLookEditor();refreshRoutingSources();document.getElementById('routingPanel').classList.add('open')};
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'){
   const openDialog=[...document.querySelectorAll('dialog[open]')].at(-1);if(openDialog){e.preventDefault();openDialog.close();return}
   if(document.getElementById('routingPanel').classList.contains('open'))closeRouting();
   if(document.getElementById('imagePanel').classList.contains('open'))closeImageManager();
   if(lookPanel.classList.contains('open'))closeLookEditor();
   if(document.getElementById('creatorPanel').classList.contains('open'))closeArchetypeCreator();
   if(document.getElementById('audioInputPanel').classList.contains('open'))document.getElementById('audioInputPanel').classList.remove('open');
 }
});
document.getElementById('zeroMap').onclick=()=>{routingMaps[target]=blankMap();saveRoutingMaps();refreshRoutingSources();if(lookPanel.classList.contains('open'))updateLookRoutingWarning()};
document.getElementById('resetMap').onclick=()=>{routingMaps[target]=normalizeRoutingMap(defaultRoutingMaps[target]);saveRoutingMaps();refreshRoutingSources();if(lookPanel.classList.contains('open'))updateLookRoutingWarning()};

const modState = {
 enabled:{energy:true,density:true,drive:true,boombap:true,tension:true,bright:true,open:true,beat:true,kick:true,snare:true},
 solo:{energy:false,density:false,drive:false,boombap:false,tension:false,bright:false,open:false,beat:false,kick:false,snare:false}
};
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
  return {name,enabled:{...modState.enabled},solo:{...modState.solo},amounts,intensity,reactivity,targetEnabled:{...targetState.enabled},targetSolo:{...targetState.solo},ctxPerf:+ctxPerf.value,globalReact:+document.getElementById('react').value,routing:structuredClone(routingMaps[target]||blankMap())};
}
function applyMusicPreset(p,{viewOnly=false}={}){
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
  if(!viewOnly){saveRoutingMaps();sendControls()}
  if(document.getElementById('routingPanel').classList.contains('open'))refreshRoutingSources();
}
function syncPresetActions(){
  const hasSelection=document.getElementById('presetSelect').value!=='';
  document.getElementById('presetSelect').disabled=!archetypes.length;
  document.getElementById('presetSave').disabled=!archetypes.length;
  document.getElementById('presetUpdate').disabled=!hasSelection;
  document.getElementById('presetSelect').presetMenu?.refresh();
}
function renderPresetControls(selectedIndex=''){
  const select=document.getElementById('presetSelect'),items=musicPresets[target]||[];select.innerHTML='';
  const empty=document.createElement('option');empty.value='';empty.textContent=items.length?'SELECT ROUTING PRESET':'NO SAVED PRESET';select.appendChild(empty);
  items.forEach((p,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=p.name;o.dataset.group='Project presets';o.dataset.managed='true';select.appendChild(o)});
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
async function manageRoutingPreset(value,remove=false){
 const a=target,arch=archetypes[a],preset=musicPresets[a]?.[+value];if(!preset)return;
 const result=await askLibraryAction(remove?{title:'DELETE ROUTING PRESET',message:`Delete “${preset.name}”?`,confirm:'DELETE',requireInput:false}:{title:'RENAME ROUTING PRESET',value:preset.name,confirm:'RENAME'});
 if(!result)return;
 const index=idToIndex.get(arch.id);if(index==null)return;
 const items=musicPresets[index],position=items.indexOf(preset);if(position<0)return;
 if(remove)items.splice(position,1);else preset.name=result;
 queueArchetypeWrite(index,{musicPresets:items});if(target===index)renderPresetControls(remove?'':position);
}
createPresetMenu(document.getElementById('presetSelect'),{label:'Routing presets',onRename:value=>manageRoutingPreset(value),onDelete:value=>manageRoutingPreset(value,true)});

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

function mediaUrl(source){return typeof source==='string'?source:source.url}
function mediaIsVideo(source){return typeof source!=='string'&&source.type?.startsWith('video/')}
const defaultImageConfigs=[];
let imageConfigs=[];
function saveImageConfigs(){queueArchetypeWrite(target,{imageConfig:imageConfigs[target]})}

let seqStates=[];
function orderedImages(a,enabledOnly=false){
 return imageConfigs[a].images.map((im,i)=>({i,order:im.order,enabled:im.enabled&&!IMAGE_SETS[a]?.[i]?.missing})).filter(x=>!enabledOnly||x.enabled).sort((x,y)=>x.order-y.order||x.i-y.i).map(x=>x.i);
}
function enabledImages(a){return orderedImages(a,true)}

function sequenceTempo(a){return engineState?.imageTiming[a]?.tempo||{bpm:120,source:'fallback'}}

function imageDwell(a,index){return engineState?.imageTiming[a]?.dwell[index]}

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


const triggerLabels={timed:['TIMED','Auto and continuous mapping'],event:['EVENT','Beat, kick and snare'],manual:['MANUAL','Buttons and shortcuts']};

function renderTriggerTransitionControls(a){
 const root=document.getElementById('triggerTransitionControls'),cfg=imageConfigs[a];
 const compatible=cfg.mode==='manual'?['manual']:[cfg.mode==='mapped'&&eventSourceIds().includes(cfg.source)?'event':'timed','manual'];
 root.innerHTML=IMAGE_TRIGGER_CLASSES.filter(id=>compatible.includes(id)).map(triggerClass=>{
   const settings=cfg.triggers[triggerClass],labels=triggerLabels[triggerClass];
   const pool=TRANSITIONS.map(item=>`<label><input type="checkbox" data-trigger-pool="${triggerClass}" value="${item.id}" ${settings.pool.includes(item.id)?'checked':''}>${item.label}</label>`).join('');
   const orders=['cycle','random-no-repeat'].map(id=>`<option value="${id}" ${settings.pickOrder===id?'selected':''}>${id==='cycle'?'Cycle':'Random · no repeat'}</option>`).join('');
   const easings=EASINGS.map(item=>`<option value="${item.id}" ${settings.easing===item.id?'selected':''}>${item.label}</option>`).join('');
   const wipes=WIPE_DIRECTIONS.map(item=>`<option value="${item.id}" ${settings.wipeDirection===item.id?'selected':''}>${item.label}</option>`).join('');
   const duration=cfg.timeBase==='beats'?`<select data-trigger-duration-beats="${triggerClass}">${TRANSITION_BEAT_OPTIONS.map(value=>`<option value="${value}" ${settings.durationBeats===value?'selected':''}>${beatLabel(value)} beat${value===1?'':'s'}</option>`).join('')}</select>`:`<input data-trigger-duration="${triggerClass}" type="number" min="0.05" max="8" step="0.05" value="${settings.duration}">`;
   return `<section class="triggerTransitionGroup" data-trigger-section="${triggerClass}"><div class="triggerTransitionHead"><div><b>${labels[0]}</b><span> · ${labels[1]}</span></div><button type="button" data-trigger-test="${triggerClass}">TEST</button></div><details class="transitionSelect"><summary aria-label="Transition effects for ${triggerClass}">${settings.pool.map(id=>TRANSITIONS.find(item=>item.id===id)?.label||id).join(', ')}</summary><div class="transitionPool">${pool}</div></details><div class="triggerSettings"><label>PICK ORDER<select data-trigger-order="${triggerClass}">${orders}</select></label><label>DURATION · ${cfg.timeBase==='beats'?'BEATS':'SEC'}${duration}</label><label>EASING<select data-trigger-easing="${triggerClass}">${easings}</select></label><label class="triggerWipe" ${settings.pool.includes('wipe')?'':'hidden'}>WIPE DIRECTION<select data-trigger-wipe="${triggerClass}">${wipes}</select></label></div></section>`;
 }).join('');
 root.querySelectorAll('[data-trigger-pool]').forEach(input=>input.onchange=()=>{
   const settings=cfg.triggers[input.dataset.triggerPool],checked=[...root.querySelectorAll(`[data-trigger-pool="${input.dataset.triggerPool}"]:checked`)].map(item=>item.value);
   if(!checked.length){input.checked=true;return}
   settings.pool=checked;input.closest('.transitionSelect').querySelector('summary').textContent=checked.map(id=>TRANSITIONS.find(item=>item.id===id)?.label||id).join(', ');root.querySelector(`[data-trigger-section="${input.dataset.triggerPool}"] .triggerWipe`).hidden=!checked.includes('wipe');saveImageConfigs();
 });
 root.querySelectorAll('[data-trigger-order]').forEach(el=>el.onchange=()=>{cfg.triggers[el.dataset.triggerOrder].pickOrder=el.value;saveImageConfigs()});
 root.querySelectorAll('[data-trigger-duration]').forEach(el=>el.onchange=()=>{const settings=cfg.triggers[el.dataset.triggerDuration];settings.duration=clamp(parseFloat(el.value)||2.2,.05,8);el.value=settings.duration;saveImageConfigs()});
 root.querySelectorAll('[data-trigger-duration-beats]').forEach(el=>el.onchange=()=>{cfg.triggers[el.dataset.triggerDurationBeats].durationBeats=+el.value;saveImageConfigs()});
 root.querySelectorAll('[data-trigger-easing]').forEach(el=>el.onchange=()=>{cfg.triggers[el.dataset.triggerEasing].easing=el.value;saveImageConfigs()});
 root.querySelectorAll('[data-trigger-wipe]').forEach(el=>el.onchange=()=>{cfg.triggers[el.dataset.triggerWipe].wipeDirection=el.value;saveImageConfigs()});
 root.querySelectorAll('[data-trigger-test]').forEach(el=>el.onclick=()=>imageStep(a,1,el.dataset.triggerTest));
}
function updateImageManagerRuntimeState(a){
 if(target!==a||!document.getElementById('imagePanel').classList.contains('open'))return;
 const cfg=imageConfigs[a],s=seqStates[a],active=enabledImages(a),orderPos=active.indexOf(s.current);
 const grid=document.getElementById('imageGrid');
 grid.querySelectorAll('[data-imgcard]').forEach(card=>card.classList.toggle('current',+card.dataset.imgcard===s.current));
 const currentCard=grid.querySelector('.current');
 if(currentCard&&grid.dataset.centered!==String(s.current)&&!grid.contains(document.activeElement)){
  grid.scrollTo({left:currentCard.offsetLeft-(grid.clientWidth-currentCard.offsetWidth)/2,behavior:grid.dataset.centered?'smooth':'instant'});grid.dataset.centered=String(s.current);
 }
 const beatStatus=document.getElementById('beatTimeStatus'),tempo=sequenceTempo(a);
 beatStatus.hidden=cfg.timeBase!=='beats';
 beatStatus.textContent=cfg.timeBase==='beats'?'BEATS · '+(tempo.source==='live'?Math.round(tempo.bpm)+' BPM':(tempo.source==='last'?'LAST RELIABLE ':'FALLBACK ')+Math.round(tempo.bpm)):'';
 document.getElementById('imageManagerStatus').textContent='Current IMAGE '+(s.current+1)+' · active position '+(orderPos>=0?orderPos+1:'—')+' / '+active.length+' · mode '+cfg.mode.toUpperCase();
}
function renderImageManager(){
 const a=target,cfg=imageConfigs[a],s=seqStates[a];
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
 document.getElementById('imageGrid').innerHTML=h;delete document.getElementById('imageGrid').dataset.centered;
 updateImageManagerRuntimeState(a);
 document.querySelectorAll('[data-imgen]').forEach(el=>el.onchange=()=>{
   const i=+el.dataset.imgen;
   imageConfigs[a].images[i].enabled=el.checked;
   if(!enabledImages(a).length){imageConfigs[a].images[i].enabled=true;el.checked=true}
   saveImageConfigs();
   if(!imageConfigs[a].images[s.current].enabled){const nxt=enabledImages(a)[0];if(nxt!=null)requestImageChange(a,nxt,'manual')}
 });
 document.querySelectorAll('[data-imgdur]').forEach(el=>el.onchange=()=>{
   const i=+el.dataset.imgdur;imageConfigs[a].images[i].duration=clamp(parseFloat(el.value)||10,2,60);el.value=imageConfigs[a].images[i].duration;saveImageConfigs();
 });
 document.querySelectorAll('[data-imgbeats]').forEach(el=>el.onchange=()=>{const i=+el.dataset.imgbeats;imageConfigs[a].images[i].durationBeats=+el.value;saveImageConfigs();renderImageManager()});
 document.querySelectorAll('[data-imgorder]').forEach(el=>el.onchange=()=>{moveImageToPosition(a,+el.dataset.imgorder,+el.value);renderImageManager()});
 document.querySelectorAll('[data-imgup]').forEach(el=>el.onclick=()=>{moveImageBy(a,+el.dataset.imgup,-1);renderImageManager()});
 document.querySelectorAll('[data-imgdown]').forEach(el=>el.onclick=()=>{moveImageBy(a,+el.dataset.imgdown,1);renderImageManager()});
}
function closeImageManager(){saveImageConfigs();document.getElementById('imagePanel').classList.remove('open')}
document.getElementById('imageMgrBtn').onclick=()=>{closeRouting();closeLookEditor();renderImageManager();document.getElementById('imagePanel').classList.add('open')};
const imageTutorialDialog=document.getElementById('imageTutorialDialog');
document.getElementById('openImageTutorial').onclick=()=>{if(!imageTutorialDialog.open)imageTutorialDialog.showModal()};
document.getElementById('closeImageTutorial').onclick=()=>imageTutorialDialog.close();
document.getElementById('imageMode').onchange=e=>{imageConfigs[target].mode=e.target.value;saveImageConfigs();renderImageManager()};
document.getElementById('imageTimeBase').onchange=e=>{imageConfigs[target].timeBase=e.target.value;saveImageConfigs();renderImageManager()};
document.getElementById('imageOrderMode').onchange=e=>{imageConfigs[target].orderMode=e.target.value;saveImageConfigs();renderImageManager()};
document.getElementById('imageSource').onchange=e=>{imageConfigs[target].source=e.target.value;saveImageConfigs();renderTriggerTransitionControls(target)};
document.getElementById('imageThreshold').onchange=e=>{imageConfigs[target].threshold=clamp(parseFloat(e.target.value)||.55,.05,.95);e.target.value=imageConfigs[target].threshold;saveImageConfigs()};
document.getElementById('carouselPrev').onclick=()=>imageStep(target,-1);
document.getElementById('carouselNext').onclick=()=>imageStep(target,1);

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
 closeImageManager();closeRouting();closeLookEditor();
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

let seeking=false,clipHoldUntil=0;
const playButton=document.getElementById('play'),seekControl=document.getElementById('seek'),volumeControl=document.getElementById('volume'),muteButton=document.getElementById('mute');
const audioDevice=document.getElementById('audioDevice'),inputTrim=document.getElementById('inputTrim');
function formatTime(seconds){if(!Number.isFinite(seconds)||seconds<0)return '0:00';return Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0')}
function updateTimeDisplay(time=engineState?.transport.currentTime||0){document.getElementById('timeDisplay').textContent=formatTime(time)+' / '+formatTime(engineState?.transport.duration||0);document.getElementById('headerElapsed').textContent=formatTime(time);document.getElementById('headerDuration').textContent=formatTime(engineState?.transport.duration||0)}
document.getElementById('file').onchange=event=>{const file=event.target.files[0];if(file)fire('audioLoad',{blob:file,name:file.name})};
playButton.onclick=()=>fire(engineState?.transport.paused?'audioPlay':'audioPause');
seekControl.oninput=()=>{seeking=true;updateTimeDisplay((+seekControl.value/1000)*(engineState?.transport.duration||0))};
seekControl.onchange=()=>{fire('audioSeek',{fraction:+seekControl.value/1000});seeking=false};
volumeControl.oninput=()=>fire('audioVolume',{value:+volumeControl.value});
muteButton.onclick=()=>fire('audioMute',{value:!engineState?.transport.muted});
document.getElementById('audioInputBtn').onclick=()=>{closeImageManager();closeRouting();creatorPanel.classList.remove('open');document.getElementById('audioInputPanel').classList.add('open');fire('enumerateInputs')};
document.getElementById('closeAudioInput').onclick=()=>document.getElementById('audioInputPanel').classList.remove('open');
document.getElementById('fileModeBtn').onclick=()=>fire('setInput',{mode:'file'});
const startLiveInput=()=>fire('setInput',{mode:'live',device:audioDevice.value});
document.getElementById('liveModeBtn').onclick=startLiveInput;document.getElementById('startLiveInput').onclick=startLiveInput;
audioDevice.onchange=()=>{try{localStorage.setItem(INPUT_DEVICE_KEY,audioDevice.value)}catch{}if(engineState?.transport.mode==='live')startLiveInput()};
inputTrim.oninput=()=>fire('setTrim',{value:+inputTrim.value});
document.getElementById('calibrateNoise').onclick=()=>fire('calibrate');
document.getElementById('clearCalibration').onclick=()=>fire('clearCalibration');
fire('enumerateInputs');
const fullscreenButton=document.getElementById('fullscreen');
function updateFullscreenButton(){const active=!!document.fullscreenElement;fullscreenButton.classList.toggle('fullscreenActive',active);fullscreenButton.setAttribute('aria-label',active?'Exit full screen':'Full screen');fullscreenButton.dataset.tooltip=active?'Exit full screen':'Full screen'}
fullscreenButton.onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();document.addEventListener('fullscreenchange',updateFullscreenButton);updateFullscreenButton();
document.getElementById('diagBtn').onclick=()=>{const d=document.getElementById('diag');d.style.display=d.style.display==='none'?'block':'none';fire('setDiagnostics',{enabled:getComputedStyle(d).display!=='none'})};
const diagnosticVisibility=new ResizeObserver(()=>fire('setDiagnostics',{enabled:getComputedStyle(document.getElementById('diag')).display!=='none'}));diagnosticVisibility.observe(document.getElementById('diag'));
const shortcutDialog=document.getElementById('shortcutDialog'),shortcutToast=document.getElementById('shortcutToast');
let shortcutToastTimer=0;
function showShortcutToast(message){
 shortcutToast.textContent=message;shortcutToast.classList.add('show');clearTimeout(shortcutToastTimer);
 shortcutToastTimer=setTimeout(()=>shortcutToast.classList.remove('show'),1100);
}
function openShortcutGuide(){if(!shortcutDialog.open)shortcutDialog.showModal()}
document.getElementById('shortcutHelpBtn').onclick=openShortcutGuide;
document.getElementById('closeShortcutDialog').onclick=()=>shortcutDialog.close();
const blackoutButton=document.getElementById('blackoutBtn'),panicButton=document.getElementById('panicBtn');
function updateSafetyUi(){
 blackoutButton.classList.toggle('active',blackoutActive);blackoutButton.setAttribute('aria-pressed',String(blackoutActive));
 panicButton.classList.toggle('active',panicActive);panicButton.setAttribute('aria-pressed',String(panicActive));
 document.getElementById('blackoutStatus').classList.toggle('active',blackoutActive);document.getElementById('panicStatus').classList.toggle('active',panicActive);
}
function setBlackout(value){blackoutActive=!!value;fire('setSafety',{control:'blackout',value:blackoutActive});return blackoutActive}

function toggleBlackout(){return setBlackout(!blackoutActive)}
function setPanic(value){panicActive=!!value;fire('setSafety',{control:'panic',value:panicActive});return panicActive}

function togglePanic(){return setPanic(!panicActive)}
blackoutButton.onclick=toggleBlackout;panicButton.onclick=togglePanic;
window.EyesForBeatsSafety={toggleBlackout,togglePanic,setBlackout,setPanic};
updateSafetyUi();
const outputController=createOutputController(transport,{onAdopt:adoptOutput,button:document.getElementById('outputBtn'),readMedia:async(id,cacheName)=>{
 if(cacheName!==repository.cache.name)return null;
 const record=await repository.getMedia(id);if(record?.blob)return record.blob;
 if(!activeProject||!repository.online)return null;
 const records=await repository.listArchetypes(activeProject.id);if(!records.some(record=>record.media.some(media=>media.mediaId===id)))return null;
 const blob=await repository.api.getMedia(id);await repository.putMedia(blob,blob.type);return blob;
}});

let target=0,mode='smooth';
let archetypeSelectionBusy=false;
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
const libraryDialog=document.getElementById('libraryDialog');
const LAST_EXPORTED_KEY='eyes4beat_project_last_exported';
async function renderLastExported(){
 let latest;try{latest=Object.entries(JSON.parse(localStorage.getItem(LAST_EXPORTED_KEY)||'{}')).sort((a,b)=>b[1].localeCompare(a[1]))[0]}catch{}
 const project=latest?await repository.getProject(latest[0]):null;
 document.getElementById('lastExported').textContent=latest?'Last exported: '+(project?.name||'Deleted project')+' · '+new Date(latest[1]).toLocaleString():'Last exported: never';
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
 await projectUi?.refresh();renderLastExported();
}
async function openProject(projectId,{preferredId=null,recovery=null}={}){
 if(libraryVersionChanged)throw new Error('Library updated in another tab; reload this page');
 const generation=++projectSwitchGeneration;projectSwitching=true;
 try{
 await flushArchetypeWrites();
 const nextProject=recovery?recovery.project:projectId?await repository.getProject(projectId):null;
 if(projectId&&(!nextProject||nextProject.deletedAt))throw new Error('Project not found');
 if(!recovery&&nextProject&&repository.online)await repository.hydrateProject(nextProject.id,(done,total)=>{document.getElementById('projectStatus').textContent=`Caching media ${done}/${total}…`}).catch(()=>{});
 const records=recovery?recovery.records:nextProject?await repository.listArchetypes(nextProject.id):[];
 const mediaRecords=new Map(),missingArchetypes=new Set();
 for(const record of records)for(const media of record.media){if(!mediaRecords.has(media.mediaId)){
   const saved=await repository.getMedia(media.mediaId);mediaRecords.set(media.mediaId,saved||null);
  }if(!mediaRecords.get(media.mediaId))missingArchetypes.add(record.name)}
 const urls=new Map();for(const [mediaId,saved] of mediaRecords)if(saved)urls.set(mediaId,URL.createObjectURL(saved.blob));
 const runtime=nextProject?buildProjectRuntime(nextProject,records,media=>mediaRecords.get(media.mediaId)?({url:urls.get(media.mediaId),type:media.mime,name:media.name,mediaId:media.mediaId}):null):null;
 if(generation!==projectSwitchGeneration){for(const url of urls.values())URL.revokeObjectURL(url);return}
 const oldUrls=new Set(IMAGE_SETS.flat().map(source=>typeof source==='string'?null:source.url).filter(Boolean));oldUrls.forEach(URL.revokeObjectURL);
 archetypes.splice(0,archetypes.length,...(runtime?.archetypes||[]));IMAGE_SETS.splice(0,IMAGE_SETS.length,...(runtime?.IMAGE_SETS||[]));
 defaultRoutingMaps.splice(0,defaultRoutingMaps.length,...(runtime?.defaultRoutingMaps||[]));routingMaps=runtime?.routingMaps||[];
 defaultImageConfigs.splice(0,defaultImageConfigs.length,...(runtime?.defaultImageConfigs||[]));imageConfigs=runtime?.imageConfigs||[];
 musicPresets=runtime?.musicPresets||[];looks=runtime?.looks||[];idToIndex=runtime?.idToIndex||new Map();
 activeProject=nextProject;target=idToIndex.get(preferredId)??0;archetypeSelectionBusy=false;
 if(!libraryVersionChanged){const notice=document.getElementById('libraryNotice');notice.hidden=!missingArchetypes.size;
 notice.textContent=missingArchetypes.size?`Missing media in: ${[...missingArchetypes].join(', ')}. Available media will continue playing.`:''}
 if(!recovery){const payload={project:nextProject,records,cacheName:repository.cache.name,preferredId};if(transport.disconnected)transport.project=structuredClone(payload);else await send('loadProject',payload)}
 if(generation!==projectSwitchGeneration)return;
 await repository.setActiveProject(activeProject?.id||null);
 projectLookPresets=activeProject?await repository.listLookPresets(activeProject.id):[];
 records.forEach(record=>startingLook(record,projectLookPresets,localStorage,repository.cache.name));renderProjectLookPresets();
 renderArchetypeBar();renderPresetControls();await refreshProjects();
 if(lookPanel.classList.contains('open')){if(archetypes.length)renderLookEditor();else closeLookEditor()}
 if(document.getElementById('imagePanel').classList.contains('open')){if(archetypes.length)renderImageManager();else closeImageManager()}
 if(document.getElementById('routingPanel').classList.contains('open')){if(archetypes.length)refreshRoutingSources();else closeRouting()}
 document.getElementById('lookBtn').disabled=!archetypes.length;document.getElementById('imageMgrBtn').disabled=!archetypes.length;
 document.getElementById('routingTab').disabled=!archetypes.length;
 document.getElementById('projectStatus').textContent='';
 }finally{if(generation===projectSwitchGeneration)projectSwitching=false}
}
async function setLiveLock(value){await send('setSafety',{control:'liveLock',value:!!value});return repository.setLiveLock(value)}
async function adoptOutput(recovery){
 adoptingOutput=true;
 try{
  await openProject(recovery.project.project?.id,{preferredId:recovery.event.state.targetId,recovery:recovery.project});
  const saved=new Map(recovery.saved);applyMusicPreset(saved.get('setControls')?.controls,{viewOnly:true});
  transport.adopt({...recovery,event:transport.transport.latestEvent||recovery.event});
  await repository.setLiveLock(!!recovery.event.state.liveLock);
 }finally{adoptingOutput=false}
}
async function initializeLibrary(recovered=false){
 updateStorageStatus();
 const projects=await repository.listProjects(),meta=await repository.getMeta();
 const initial=projects.find(project=>project.id===meta.lastActiveProjectId)||projects[0]||null;
 if(!recovered&&!transport.transport.recovery)await openProject(initial?.id||null,{});
 try{document.getElementById('legacySection').hidden=!(await legacyDataAvailable())}catch(error){console.warn('Legacy archive check failed',error)}
 if(!projects.length)libraryDialog.showModal();
 void repository.initialize().then(async()=>{
   const migrationKey=`eyes4beat_local_migration_${repository.email}`;if(!repository.email||localStorage.getItem(migrationKey))return;
   const legacy=new LocalLibraryRepository('eyes4beat-library');const localProjects=await legacy.listProjects();
   if(!localProjects.length){localStorage.setItem(migrationKey,'empty');await legacy.close();return}
   const upload=confirm(`Upload ${localProjects.length} local project${localProjects.length===1?'':'s'} to your account? The local database will be kept.`);
   localStorage.setItem(migrationKey,upload?'uploading':'skipped');
   if(upload)try{await repository.migrateLocalProjects(legacy);localStorage.setItem(migrationKey,'complete');await repository.sync();location.reload()}catch(error){localStorage.removeItem(migrationKey);document.getElementById('projectStatus').textContent='Local project upload failed: '+error.message}
   await legacy.close();
 }).catch(()=>{});
}
document.getElementById('closeLibrary').onclick=()=>libraryDialog.close();
const projectNameDialog=document.getElementById('projectNameDialog'),projectNameInput=document.getElementById('projectNameInput');
let projectDialogAction='create',projectDialogRecord=null;
function openProjectDialog(action,project=null){
 projectDialogRecord=project;
 projectDialogAction=action;const deleting=action==='delete';
 document.getElementById('projectDialogTitle').textContent=action==='create'?'CREATE PROJECT':deleting?'DELETE PROJECT':'RENAME PROJECT';
 document.getElementById('projectDialogLabel').textContent=deleting?`TYPE “${project.name}” TO CONFIRM`:'PROJECT NAME';
 document.getElementById('confirmProjectDialog').textContent=action.toUpperCase();
 document.getElementById('confirmProjectDialog').classList.toggle('dangerBtn',deleting);
 projectNameInput.value=action==='rename'?project.name:'';
 document.getElementById('projectDialogError').textContent='';projectNameDialog.showModal();projectNameInput.focus();
}
document.getElementById('cancelProjectDialog').onclick=()=>projectNameDialog.close();
document.getElementById('closeProjectDialog').onclick=()=>projectNameDialog.close();
document.getElementById('projectNameForm').onsubmit=async event=>{
 event.preventDefault();const name=projectNameInput.value.trim(),button=document.getElementById('confirmProjectDialog');
 if(projectDialogAction==='delete'&&name!==projectDialogRecord.name){document.getElementById('projectDialogError').textContent='The name does not match.';return}
 button.disabled=true;
 try{
  if(projectDialogAction==='create'){const project=await repository.createProject(name);await openProject(project.id);libraryDialog.close()}
  else if(projectDialogAction==='rename'){const updated=await repository.updateProject(projectDialogRecord.id,{name});if(activeProject?.id===updated.id)activeProject=updated;await refreshProjects()}
  else{await flushArchetypeWrites();await repository.deleteProject(projectDialogRecord.id);if(activeProject?.id===projectDialogRecord.id){const remaining=await repository.listProjects();await openProject(remaining[0]?.id||null)}await refreshProjects()}
  projectNameDialog.close();
 }catch(error){document.getElementById('projectDialogError').textContent=error.message}
 finally{button.disabled=false}
};
document.getElementById('createProject').onclick=()=>openProjectDialog('create');
async function projectRowAction(action,project,button){
 if(['share','delete'].includes(action)&&project.ownerEmail!==repository.email)return;
 if(action==='rename'||action==='delete'){openProjectDialog(action,project);return}
 if(action==='export'){await exportProject(project,button);return}
 if(action==='duplicate'){await flushArchetypeWrites();await repository.duplicateProject(project.id)}
 if(action==='share'){const updated=await repository.setProjectVisibility(project.id,project.visibility==='shared'?'private':'shared');if(activeProject?.id===updated.id)activeProject=updated;await repository.sync()}
 await refreshProjects();
}
document.getElementById('syncNow').onclick=()=>repository.sync().catch(error=>{document.getElementById('accountError').textContent=error.message});
document.getElementById('signOut').onclick=()=>{location.href='/cdn-cgi/access/logout'};
document.getElementById('liveLockBtn').onclick=()=>setLiveLock(!repository.state.liveLock).catch(console.error);
addEventListener('focus',()=>{void repository.sync().catch(()=>{})});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void repository.sync().catch(()=>{})});
function renderArchetypeBar(){
 const bar=document.getElementById('archBar');bar.innerHTML='';
 if(!archetypes.length){const empty=document.createElement('span');empty.className='archEmpty';empty.textContent=activeProject?'No archetypes yet — create one or import a package.':'Create or import a project to begin.';bar.appendChild(empty)}
 archetypes.forEach((arch,index)=>{
   const button=document.createElement('button');button.className='arch'+(index===target?' active':'');button.dataset.a=String(index);
   const origin=arch.origin?.type||'blank',subtitle=origin==='factory'?(FACTORY_LOOKS.find(preset=>preset.id===arch.origin.presetId)?.subtitle||'factory look'):origin==='project-preset'?'project look preset':origin==='import'?'imported':'blank look';
   button.innerHTML='<b></b><span></span>';button.querySelector('b').textContent=(index+1)+' · '+arch.name;button.querySelector('span').textContent=subtitle;button.onclick=()=>selectArchetype(index);
   const item=document.createElement('div');item.className='archItem';item.appendChild(button);
   const actions=[['panel-right','Edit archetype (E)',()=>document.getElementById('lookBtn').click()],['pencil','Rename archetype',async()=>{const name=await askLibraryAction({title:'RENAME ARCHETYPE',value:arch.name,confirm:'RENAME'});if(!name)return;fire('updateArchetype',{id:arch.id,patch:{name}});await repository.updateArchetype(arch.id,{name});arch.name=name;renderArchetypeBar();if(lookPanel.classList.contains('open'))renderLookEditor()}],
    ['copy','Duplicate archetype',async()=>{await flushArchetypeWrites();const duplicate=await repository.duplicateArchetype(arch.id);await openProject(activeProject.id,{preferredId:duplicate.id})}],
    ['chevron-left','Move archetype earlier',async()=>{if(index===0)return;const order=[...activeProject.archetypeOrder];[order[index-1],order[index]]=[order[index],order[index-1]];await repository.reorderArchetypes(activeProject.id,order);await openProject(activeProject.id,{preferredId:arch.id})}],
    ['chevron-right','Move archetype later',async()=>{if(index===archetypes.length-1)return;const order=[...activeProject.archetypeOrder];[order[index],order[index+1]]=[order[index+1],order[index]];await repository.reorderArchetypes(activeProject.id,order);await openProject(activeProject.id,{preferredId:arch.id})}],
    ['trash-2','Delete archetype',()=>openDeleteArchetype(arch.id)]];
   const toolbar=document.createElement('div');toolbar.className='archToolbar';for(const [glyph,label,action] of actions){const control=document.createElement('button');control.type='button';control.className='iconAction';control.innerHTML=icon(glyph);control.setAttribute('aria-label',label+' '+arch.name);control.dataset.tooltip=label;control.onclick=()=>Promise.resolve(action()).catch(error=>{console.error(error);alert(error.message)});toolbar.appendChild(control)}item.appendChild(toolbar);bar.appendChild(item);
 });
 const actions=document.getElementById('footerActions');actions.replaceChildren(document.getElementById('archBarToggle'));
 const createButton=document.createElement('button');createButton.id='archetypeCreatorBtn';createButton.type='button';createButton.className='iconAction footerTab';createButton.dataset.tooltip='Create archetype';createButton.setAttribute('aria-label','Create archetype');createButton.innerHTML=icon('plus');createButton.onclick=()=>activeProject?openArchetypeCreator():libraryDialog.showModal();actions.appendChild(createButton);
 const verifyButton=document.createElement('button');verifyButton.id='verifyPackageBtn';verifyButton.type='button';verifyButton.className='iconAction footerTab';verifyButton.innerHTML=icon('file-check-2');verifyButton.dataset.tooltip='Verify package';verifyButton.setAttribute('aria-label','Verify package');verifyButton.onclick=()=>document.getElementById('verifyPackageFile').click();actions.appendChild(verifyButton);
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
async function exportProject(project,button){
 try{
  await flushArchetypeWrites();
  const records=new Map((await repository.listArchetypes(project.id)).map(record=>[record.id,record]));
  const snapshot=[];for(const id of project.archetypeOrder){const record=records.get(id);if(!record)continue;
    const media=[];for(const [sourceIndex,ref] of record.media.entries()){const saved=await repository.getMedia(ref.mediaId);if(!saved)throw new Error(`Cannot export ${record.name}: missing media ${ref.name}`);media.push({...ref,sourceIndex,blob:saved.blob})}
    snapshot.push({id:record.id,name:record.name,origin:record.origin,look:record.look,routingMap:record.routingMap,imageConfig:record.imageConfig,musicPresets:record.musicPresets,media});
  }
  await exportPackage(snapshot,{kind:'project',project,lookPresets:await repository.listLookPresets(project.id),button});
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
    dialog.close();libraryDialog.close();await openProject(project.id);
   }catch(error){console.error('Import failed',error);status.textContent=imported?`Import saved, but opening failed: ${error.message}`:`Import stopped: ${error.message}. No partial import was saved.`;apply.disabled=false}
  };
 }catch(error){console.error('Package validation failed',error);document.getElementById('projectStatus').textContent=error.message}
};
async function selectArchetype(a){
 if(!archetypes[a]||projectSwitching||deletingArchetype)return;
 if(remoteRefreshPending){remoteRefreshPending=false;await openProject(activeProject.id,{preferredId:archetypes[a].id});return}
 await send('selectArchetype',{id:archetypes[a].id});
}

const archBarToggle=document.getElementById('archBarToggle'),uiRoot=document.querySelector('.ui'),archBar=document.getElementById('archBar');
function updateFooterMetrics(){uiRoot.style.setProperty('--footer-height',`${Math.ceil(archBar.getBoundingClientRect().height)}px`)}
new ResizeObserver(updateFooterMetrics).observe(archBar);updateFooterMetrics();
function setArchetypeBarCollapsed(collapsed){
 uiRoot.classList.toggle('footerCollapsed',collapsed);
 archBarToggle.setAttribute('aria-expanded',String(!collapsed));archBarToggle.classList.toggle('collapsed',collapsed);
 const label=collapsed?'Show archetypes':'Hide archetypes';archBarToggle.dataset.tooltip=label;archBarToggle.setAttribute('aria-label',label);archBarToggle.title=label;
 try{localStorage.setItem('eyesforbeats_footer_collapsed',collapsed?'1':'0')}catch(e){}
}
let footerStartsCollapsed=false;
try{footerStartsCollapsed=localStorage.getItem('eyesforbeats_footer_collapsed')==='1'}catch(e){}
setArchetypeBarCollapsed(footerStartsCollapsed);
archBarToggle.onclick=()=>setArchetypeBarCollapsed(!uiRoot.classList.contains('footerCollapsed'));
const smoothButton=document.getElementById('smooth'),cutButton=document.getElementById('cut');
function setTransitionMode(next){fire('setTransition',{mode:next})}
smoothButton.onclick=()=>setTransitionMode('smooth');
cutButton.onclick=()=>setTransitionMode('cut');
function shortcutTypingContext(element){return !!document.querySelector('dialog[open]')||element?.matches?.('input,textarea,select,[contenteditable="true"]')||!!element?.closest?.('[contenteditable="true"]')}
document.addEventListener('keydown',event=>{
 if(event.repeat||shortcutTypingContext(event.target))return;
 const action=resolvePerformanceShortcut(event,archetypes.length);if(!action)return;
 event.preventDefault();
 if(action.type==='help'){openShortcutGuide();return}
 if(action.type==='live-lock'){void setLiveLock(!repository.state.liveLock);showShortcutToast('LIVE LOCK · '+(!repository.state.liveLock?'ON':'OFF'));return}
 if(action.type==='safety'){
   const active=action.control==='blackout'?toggleBlackout():togglePanic();
   showShortcutToast(action.control.toUpperCase()+' · '+(active?'ON':'OFF'));return;
 }
 if(action.type==='transition'){setTransitionMode(action.mode);showShortcutToast(action.mode.toUpperCase()+' TRANSITIONS');return}
 if(action.type==='preset-select'){activatePreset(action.index);return}
 if(action.type==='preset-step'){stepPreset(action.direction);return}
 if(action.type==='media-step'){
   imageStep(target,action.direction);showShortcutToast(action.direction>0?'NEXT MEDIA':'PREVIOUS MEDIA');return;
 }
 const index=action.type==='step'?(target+action.direction+archetypes.length)%archetypes.length:action.index;
 showShortcutToast(String(index+1).padStart(2,'0')+' · '+archetypes[index].name+' — '+mode.toUpperCase());selectArchetype(index);
});

function imageStep(a,direction,trigger='manual'){const id=archetypes[a]?.id;if(id)fire('imageStep',{id,direction,trigger})}
function requestImageChange(a,index,trigger='manual'){const id=archetypes[a]?.id;if(id)fire('imageGoto',{id,index,trigger})}
function sendControls(){
 const controls=captureMusicPreset('');delete controls.name;delete controls.routing;
 fire('setControls',{controls});
}
// Only control actions cross the boundary; editor persistence remains in the UI.
const controlSelector='[data-on],[data-solo],[data-target-on],[data-target-solo],#ctxPerf,#react,'+sourceKeys.map(k=>'#amt-'+k).join(',')+','+routeTargets.flatMap(k=>['#g-'+k,'#ga-'+k]).join(',');
for(const event of ['input','change','click'])document.addEventListener(event,e=>{if(e.target.closest?.(controlSelector))sendControls()});
const outputSettingsDialog=document.getElementById('outputSettingsDialog');
document.getElementById('outputSettingsBtn').onclick=()=>outputSettingsDialog.showModal();
document.getElementById('closeOutputSettings').onclick=()=>outputSettingsDialog.close();
document.getElementById('bloomQuality').onchange=event=>fire('setQuality',{value:event.target.value});
document.getElementById('renderScale').oninput=event=>{
 document.getElementById('renderScaleValue').textContent=Math.round(Number(event.target.value)*100)+'%';
 fire('setRenderScale',{value:Number(event.target.value)});
};
transport.subscribe(event=>{
 if(event.type==='error'){document.getElementById(event.source==='renderer'?'bloomDiagnostics':'inputWarning').textContent=event.message;return}
 if(event.type!=='state')return;
 const previousTarget=engineState?.targetId;engineState=event.state;
 blackoutActive=engineState.blackout;panicActive=engineState.panic;updateSafetyUi();
 clipHoldUntil=renderEngineState(engineState,{seeking,clipHoldUntil});
 if(engineState.projectId!==activeProject?.id&&!(engineState.projectId===null&&activeProject===null))return;
 target=engineState.target;mode=engineState.mode;archetypeSelectionBusy=engineState.archetypeSelectionBusy;
 seqStates=engineState.sequences;
 smoothButton.classList.toggle('active',mode==='smooth');cutButton.classList.toggle('active',mode==='cut');
 document.querySelectorAll('.arch').forEach(button=>button.classList.toggle('active',+button.dataset.a===target));
 if(previousTarget!==engineState.targetId&&!projectSwitching&&archetypes.length){
  renderPresetControls();if(lookPanel.classList.contains('open'))renderLookEditor();
  if(document.getElementById('routingPanel').classList.contains('open'))refreshRoutingSources();
  if(document.getElementById('imagePanel').classList.contains('open'))renderImageManager();
 }
 if(archetypes[target]&&seqStates[target])updateImageManagerRuntimeState(target);
});
const workspaceLayout=createWorkspaceLayout({
 showToast:showShortcutToast,
 getSelection:()=>archetypes[target]?.name||'No archetype selected',
 getProject:()=>activeProject?.name||'Projects',
});
transport.subscribe(event=>{if(event.type==='state')workspaceLayout.update(event.state)});
projectUi=createProjectUi({repository,getCurrent:()=>activeProject,selectProject:openProject,
 createProject:()=>openProjectDialog('create'),rowAction:projectRowAction,
 pending:()=>({pendingIds:[...pendingWrites.keys()],failedIds:[...failedWrites.keys()]}),
 closeEditing:()=>document.getElementById('closeInspector').click()});

sendControls();

const recovered=await outputController.discover();discoveringOutput=false;
await initializeLibrary(!!recovered);

// Read-only snapshot subscription for integrations and browser regression tests.
export const subscribeEngine=listener=>transport.subscribe(listener);
window.EyesForBeatsEngine={subscribe:subscribeEngine};
