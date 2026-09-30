import { version } from '../../package.json';
import { setupInspectorLayout } from './inspector-layout.js';
import { icon, initIcons } from '../icons.js';

// Reparent existing controls, preserving their event handlers and engine command path.
export function createWorkspaceLayout({getSelection,getProject,showToast}){
 const el=id=>document.getElementById(id),ui=document.querySelector('.ui'),top=document.querySelector('.top');
 const make=(tag,className,html='')=>{const node=document.createElement(tag);node.className=className;node.innerHTML=html;return node};
 const move=(parent,...nodes)=>nodes.forEach(node=>parent.append(typeof node==='string'?el(node):node));
 const button=(id,label,glyph,key)=>{const b=make('button','iconAction headerIcon',glyph?icon(glyph):'');b.id=id;b.type='button';b.setAttribute('aria-label',label);tip(b,label,key);return b};
 function tip(node,label,key){node.dataset.tooltip=label+(key?' ('+key+')':'');node.title=node.dataset.tooltip}
 const groups=['Project','Audio','Live','Output','View','App'].map(name=>{const group=make('section','headerGroup group'+name);group.setAttribute('aria-label',name);return group});
 const [project,audio,live,output,view,app]=groups;top.append(...groups);
 const projectButton=el('projectManageBtn');projectButton.innerHTML=icon('folder-open')+'<span id="projectName"></span><span id="syncDot" class="statusDot"></span>'+icon('chevron-down');projectButton.classList.add('projectDropdown');projectButton.setAttribute('aria-expanded','false');
 const brand=button('aboutBtn','About EyesForBeats','','');brand.innerHTML='<img src="/assets/brand/eyesforbeats-mark.png" alt="">';brand.setAttribute('aria-expanded','false');
 const about=make('div','aboutPopover','<strong>EyesForBeats</strong><p>Version '+version+'</p>');about.id='aboutPopover';about.hidden=true;brand.setAttribute('aria-controls',about.id);project.append(brand,about);
 brand.onclick=()=>{about.hidden=!about.hidden;brand.setAttribute('aria-expanded',String(!about.hidden))};
 document.addEventListener('click',e=>{if(!brand.contains(e.target)&&!about.contains(e.target)){about.hidden=true;brand.setAttribute('aria-expanded','false')}});
 move(project,projectButton);
 const accountButton=el('accountBtn');
 const audioDetails=make('div','audioFileControls');audioDetails.dataset.audioMode='file';
 move(audioDetails,document.querySelector('.audioLoad'),document.querySelector('.trackInfo'),'timeDisplay');
 el('audioInputPanel').querySelector('.audioInputGrid').prepend(audioDetails);
 const load=document.querySelector('.audioLoad');load.classList.remove('headerIcon');load.dataset.tooltip='Load file';load.setAttribute('aria-label','Load file');
 el('timeDisplay').hidden=true;
 const timeline=make('div','headerTimeline');timeline.id='headerTimeline';
 timeline.append(make('span','headerTime','0:00'));timeline.firstChild.id='headerElapsed';move(timeline,'seek');const duration=make('span','headerTime','0:00');duration.id='headerDuration';timeline.append(duration);
 const inputMeter=make('meter','headerInputMeter');inputMeter.id='headerInputMeter';inputMeter.min=-60;inputMeter.max=0;inputMeter.value=-60;inputMeter.hidden=true;inputMeter.setAttribute('aria-label','Live input level');
 move(audio,'play',timeline,inputMeter,'mute','volume','audioInputBtn');
 el('audioInputBtn').innerHTML=icon('audio-lines')+'<span id="audioSourceLabel">FILE</span>';
 const tempo=make('span','tempoReadout','<span id="beatDot" class="statusDot"></span><b id="headerBpm">—</b> BPM');audio.append(tempo);
 move(live,'blackoutBtn','panicBtn','liveLockBtn',document.querySelector('.modeSwitch'));
 for(const [id,label] of [['blackoutBtn','BLACKOUT'],['panicBtn','PANIC'],['liveLockBtn','LIVE LOCK']]){el(id).append(make('span','',label));el(id).classList.add('liveAction')}
 el('outputBtn').innerHTML=icon('monitor-up')+'<span id="outputLabel">OPEN</span><span class="statusDot"></span>';
 const previewButton=el('previewBtn');
 function updatePreviewAction(){const enabled=previewButton.getAttribute('aria-pressed')==='true',label=enabled?'Hide preview':'Show preview';previewButton.innerHTML=icon(enabled?'eye-off':'eye');previewButton.setAttribute('aria-label',label);tip(previewButton,label,'V')}
 updatePreviewAction();new MutationObserver(updatePreviewAction).observe(previewButton,{attributes:true,attributeFilter:['aria-pressed']});
 el('outputSettingsBtn').innerHTML=icon('monitor-cog');
 move(output,'outputBtn','previewBtn');
 const more=button('outputMenuBtn','App menu','ellipsis','O'),menu=make('div','outputMenu');menu.hidden=true;menu.id='outputMenu';more.setAttribute('aria-expanded','false');app.append(more,menu,accountButton);
 for(const [id,label] of [['diagBtn','Diagnostics'],['outputSettingsBtn','Output settings'],['shortcutHelpBtn','Keyboard shortcuts']]){el(id).append(make('span','',label));move(menu,id)}
 const perform=button('performBtn','Perform mode','radio','Q');perform.append(make('span','','PERFORM'));perform.setAttribute('aria-pressed','false');
 move(view,perform,'fullscreen');
 top.classList.add('workspaceHeader');
 // Keep editable performance controls in the inspector, outside the live group.
 const inspector=make('aside','inspector');inspector.id='archetypeInspector';inspector.setAttribute('aria-label','Archetype inspector');
 inspector.innerHTML='<header class="panelHeading"><h2 id="inspectorName"></h2></header><div class="inspectorTabs" role="tablist" aria-label="Archetype editing"></div>';
 const close=button('closeInspector','Close inspector','x','Escape');close.className='iconAction closeAction';inspector.firstChild.append(close);
 ui.append(inspector);
 const routingPanel=el('routingPanel');
 move(routingPanel,document.querySelector('.presetDock'));
 const routingGlobals=make('div','routingGlobals');move(routingGlobals,el('react'),document.querySelector('.contextControl'));el('lab').querySelector('.accordionBody').prepend(routingGlobals);
 move(routingPanel,el('lab'));
 const tabs=[['lookBtn','LOOK','palette','lookPanel','E'],['routingTab','ROUTING','cable','routingPanel','R'],['imageMgrBtn','IMAGES','images','imagePanel','I']];
 const strip=make('nav','inspectorStrip');strip.id='inspectorStrip';strip.setAttribute('aria-label','Open archetype inspector');
 for(const [id,label,glyph,,key] of tabs){
  const shortcut=button('inspectorShortcut-'+id,'Open '+label,glyph,key);shortcut.className='iconAction inspectorShortcut';shortcut.disabled=true;
  shortcut.setAttribute('aria-controls','archetypeInspector');shortcut.onclick=()=>{el(id).click();if(inspector.classList.contains('open'))el(id).focus()};strip.append(shortcut);
 }
 ui.append(strip);
 const pages=tabs.map(t=>el(t[3]));
 const toggleDiagnostics=el('diagBtn').onclick;
 function hideDiagnostics(){if(getComputedStyle(el('diag')).display!=='none')toggleDiagnostics()}
 const sidePanels=[inspector,el('audioInputPanel'),el('creatorPanel')];
 function closeInspector(){for(const page of pages)page.classList.remove('open');inspector.classList.remove('open')}
 function closeSides(except){hideDiagnostics();for(const panel of sidePanels)if(panel!==except){panel.classList.remove('open');if(panel===inspector)closeInspector()}}
 function showTab(id){
  if(document.body.classList.contains('performMode')||el('lookBtn').disabled)return;
  closeSides(inspector);
  for(const [tabId,,,pageId] of tabs){const selected=tabId===id;el(pageId).classList.toggle('open',selected);el(tabId).setAttribute('aria-selected',String(selected));el(tabId).tabIndex=selected?0:-1}
  inspector.classList.add('open');el('inspectorName').textContent=getSelection();
 }
 for(const [id,label,glyph,pageId,key] of tabs){
  const tab=el(id)||button(id,label,glyph,key),previous=tab.onclick;
  tab.className='inspectorTab';tab.innerHTML=icon(glyph)+'<span>'+label+'</span>';tab.setAttribute('role','tab');tab.setAttribute('aria-controls',pageId);tip(tab,label,key);
  inspector.querySelector('.inspectorTabs').append(tab);move(inspector,pageId);el(pageId).setAttribute('role','tabpanel');el(pageId).setAttribute('aria-labelledby',id);
  tab.onclick=()=>{if(document.body.classList.contains('performMode')){showToast('Exit perform mode (Q) to edit');return}if(el('lookBtn').disabled)return;previous?.();showTab(id)};
  tab.onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();event.stopPropagation();const n=tabs.findIndex(t=>t[0]===id),next=tabs[(n+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length][0];el(next).click();el(next).focus()};
 }
 top.replaceChildren(...groups);
 close.onclick=closeInspector;
 el('diagBtn').onclick=()=>{if(getComputedStyle(el('diag')).display!=='none'){toggleDiagnostics();return}closeSides();toggleDiagnostics()};

 {const old=el('audioInputBtn').onclick;el('audioInputBtn').onclick=()=>{closeSides(el('audioInputPanel'));old?.()}}
 // Follow the trigger's actual bounds, including future header reordering.
 const audioPanel=el('audioInputPanel');let anchorFrame=0,anchorPosition='';
 function positionAudioPanel(){
  cancelAnimationFrame(anchorFrame);if(!audioPanel.classList.contains('open'))return;
  const trigger=el('audioInputBtn').getBoundingClientRect(),width=audioPanel.getBoundingClientRect().width;
  const left=Math.max(16,Math.min(innerWidth-width-16,trigger.left+trigger.width/2-width/2)),top=trigger.bottom+12;
  const position=[left,top,Math.max(80,innerHeight-top-16)].join(',');
  if(position!==anchorPosition){audioPanel.style.left=left+'px';audioPanel.style.top=top+'px';audioPanel.style.maxHeight=Math.max(80,innerHeight-top-16)+'px';anchorPosition=position}
  anchorFrame=requestAnimationFrame(positionAudioPanel);
 }
 new MutationObserver(positionAudioPanel).observe(audioPanel,{attributes:true,attributeFilter:['class']});

 // Structural actions can also open a side panel (empty project / archetype creator).
 for(const panel of sidePanels)new MutationObserver(records=>{if(records.some(r=>!r.oldValue?.split(' ').includes('open'))&&panel.classList.contains('open'))closeSides(panel)}).observe(panel,{attributes:true,attributeFilter:['class'],attributeOldValue:true});
 const meters=make('div','performMeters');meters.setAttribute('aria-label','Active source meters');ui.append(meters);
 for(const name of ['energy','density','drive','boombap','tension','bright','open','beat','kick','snare']){const row=make('label','compactMeter',name+'<meter min="0" max="1" value="0"></meter>');row.dataset.source=name;meters.append(row)}
 function setPerform(value){closeSides();menu.hidden=true;about.hidden=true;document.body.classList.toggle('performMode',value);perform.setAttribute('aria-pressed',String(value));if(value)document.querySelector('.ui').classList.remove('footerCollapsed')}
 perform.onclick=()=>setPerform(!document.body.classList.contains('performMode'));
 more.onclick=()=>{menu.hidden=!menu.hidden;more.setAttribute('aria-expanded',String(!menu.hidden))};
 menu.addEventListener('click',e=>{if(e.target.closest('button')){menu.hidden=true;more.setAttribute('aria-expanded','false')}});
 const keys={KeyE:'lookBtn',KeyR:'routingTab',KeyI:'imageMgrBtn',KeyJ:'projectManageBtn',KeyK:'accountBtn',KeyA:null,KeyN:'audioInputBtn',KeyO:'outputMenuBtn',KeyV:'previewBtn',KeyF:'fullscreen',KeyG:'outputBtn',KeyH:'diagBtn',KeyY:'outputSettingsBtn',Space:'play',KeyM:'mute'};
 const tips={projectManageBtn:['Projects','J'],audioInputBtn:['Audio input','N'],play:['Play / pause','Space'],mute:['Mute','M'],blackoutBtn:['Blackout','B'],panicBtn:['Panic','P'],liveLockBtn:['Live lock','L'],smooth:['Smooth transition','S'],cut:['Cut transition','C'],outputBtn:['Open / focus output','G'],fullscreen:['Fullscreen','F'],diagBtn:['Diagnostics','H'],outputSettingsBtn:['Output settings','Y'],shortcutHelpBtn:['Keyboard shortcuts','?'],accountBtn:['Account','K']};
 for(const [id,[label,key]] of Object.entries(tips))tip(el(id),label,key);
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeSides();menu.hidden=true;about.hidden=true;brand.setAttribute('aria-expanded','false');return}
  if(event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||document.querySelector('dialog[open]')||event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  if(event.code==='KeyQ'){event.preventDefault();perform.click();return}
  const id=keys[event.code];if(!id)return;
  if(document.body.classList.contains('performMode')&&['lookBtn','routingTab','imageMgrBtn','projectManageBtn','diagBtn','outputSettingsBtn','outputMenuBtn'].includes(id)){
   if(tabs.some(tab=>tab[0]===id)){event.preventDefault();showToast('Exit perform mode (Q) to edit')}
   return;
  }
  event.preventDefault();el(id).click();
 });
 document.addEventListener('click',event=>{if(!app.contains(event.target)){menu.hidden=true;more.setAttribute('aria-expanded','false')}});
 new ResizeObserver(()=>ui.style.setProperty('--header-bottom',Math.ceil(top.getBoundingClientRect().bottom+16)+'px')).observe(top);
 for(const control of document.querySelectorAll('.closeAction'))tip(control,control.getAttribute('aria-label')||'Close','Escape');
 const shortcutGrid=el('shortcutDialog').querySelector('.shortcutList');
 if(shortcutGrid)for(const [key,label] of [['E / R / I','Inspector tabs'],['J / N','Projects / Audio input'],['K','Account menu'],['G / V / F','Output / Preview / Fullscreen'],['O / H / Y','App menu / Diagnostics / Output settings'],['Space / M','Play / pause / Mute'],['Q','Perform mode']])shortcutGrid.append(make('div','', '<kbd>'+key+'</kbd><span>'+label+'</span>'));
 el('projectName').textContent=getProject();
 setupInspectorLayout();
 initIcons(inspector);
 return {update(state){
  for(const shortcut of strip.children)shortcut.disabled=!state.targetId;
  el('inspectorName').textContent=getSelection();el('projectName').textContent=getProject();el('headerBpm').textContent=state.bpm>0?Math.round(state.bpm):'—';el('beatDot').style.opacity=String(.2+.8*state.beat);
  el('audioSourceLabel').textContent=state.transport.mode.toUpperCase();timeline.hidden=state.transport.mode==='live';inputMeter.hidden=state.transport.mode!=='live';inputMeter.value=state.analysis?.meter?.peakDb??-60;inputMeter.title='Input peak '+inputMeter.value.toFixed(1)+' dBFS';
  el('outputLabel').textContent=el('outputBtn').classList.contains('connected')?'CONNECTED':document.body.classList.contains('remoteControl')?'REOPEN':'OPEN';
  for(const [id,[label,key]] of Object.entries(tips))tip(el(id),label,key);
  const solo=[...document.querySelectorAll('[data-solo].active')].map(n=>n.dataset.solo);
  for(const row of meters.children){const name=row.dataset.source;row.hidden=solo.length?!solo.includes(name):!document.querySelector('[data-on="'+name+'"]').checked;row.querySelector('meter').value=state.eff[name]??state[name]??0}
 }};
}
