import {icon} from '../icons.js';

export function projectSyncStatus({project,ready,state={},meta={},pendingIds=[],failedIds=[]}){
 if(!project)return {kind:'offline',text:'No project selected'};
 const ids=new Set(project.archetypeOrder||[]),belongs=(key,item={})=>
  key==='projects:'+project.id||item.projectId===project.id||item.changes?.projectId===project.id||
  item.server?.project_id===project.id||item.server?.projectId===project.id||
  (key.startsWith('archetypes:')&&ids.has(key.slice(11)));
 if(failedIds.some(id=>ids.has(id))||Object.entries(meta.conflicts||{}).some(([k,v])=>belongs(k,v))||state.status==='session-expired')
  return {kind:'error',text:'Project sync error · '+(state.status==='session-expired'?'sign in again':'changes need attention')};
 if(pendingIds.some(id=>ids.has(id))||Object.entries(meta.dirty||{}).some(([k,v])=>belongs(k,v))||(meta.deferred||[]).some(v=>belongs(v.store+':'+v.value.id,v.value)))
  return {kind:'pending',text:'Project has pending changes'+(ready?' · ready offline':' · media missing')};
 if(state.status==='offline')return {kind:ready?'offline-ready':'offline',text:ready?'Offline · project ready to perform':'Offline · project media missing'};
 if(state.status==='syncing')return {kind:'pending',text:'Checking project sync'+(ready?' · ready offline':'')};
 return {kind:'synced',text:'Project synced'+(ready?' · ready offline':' · media missing')};
}
export function projectActions(project,email){
 return ['rename','duplicate',...(project.ownerEmail===email&&email?['share','delete']:[]),'export'];
}
export function createProjectUi({repository,getCurrent,selectProject,createProject,rowAction,pending,closeEditing}){
 const el=id=>document.getElementById(id),switcher=el('projectSwitcher'),list=el('projectSwitcherList'),library=el('libraryDialog'),account=el('accountMenu'),button=el('projectManageBtn'),avatar=el('accountBtn');
 let projects=[],readiness=new Map(),refreshVersion=0,statusVersion=0;
 const make=(tag,text,cls='')=>{const node=document.createElement(tag);node.textContent=text;node.className=cls;return node};
 function position(dropdown,anchor,right=false){const rect=anchor.getBoundingClientRect();dropdown.style.top=(rect.bottom+8)+'px';dropdown.style.left=right?'auto':Math.max(8,Math.min(rect.left,innerWidth-dropdown.offsetWidth-8))+'px';dropdown.style.right=right?Math.max(8,innerWidth-rect.right)+'px':'auto'}
 function closeMenus(){switcher.hidden=true;account.hidden=true;button.setAttribute('aria-expanded','false');avatar.setAttribute('aria-expanded','false')}
 function error(message){el(switcher.hidden?'projectStatus':'projectSwitcherError').textContent=message}
 async function updateSync(){
  const project=getCurrent(),version=++statusVersion;let meta;
  try{
   meta=await repository.syncMeta();
   // Preset edits carry an id but no project id in the existing sync journal.
   for(const [key,item] of Object.entries(meta.dirty||{}))if(key.startsWith('lookPresets:')){
    const record=await repository.cache.get('lookPresets',item.id||key.slice(12));if(record)item.projectId=record.projectId;
   }
  }catch{return}
  if(version!==statusVersion||project?.id!==getCurrent()?.id)return;
  const status=projectSyncStatus({project,ready:readiness.get(project?.id),state:repository.state,meta,...pending()});
  const dot=el('syncDot');dot.dataset.state=status.kind;dot.title=status.text;dot.setAttribute('aria-label',status.text);
 }
 function render(){
  list.replaceChildren();el('projectRows').replaceChildren();el('projectEmptyHint').hidden=!!projects.length;
  for(const project of projects){
   const ready=readiness.get(project.id),shared=project.visibility==='shared';
   const item=make('button','','projectChoice');item.type='button';item.dataset.projectId=project.id;item.setAttribute('role','menuitemradio');item.setAttribute('aria-checked',String(project.id===getCurrent()?.id));item.title='Switch to '+project.name;
   const name=make('span',project.name,'projectChoiceName');item.append(name);
   if(shared)item.append(make('span',project.ownerEmail||'Local','projectOwner'));
   const badges=make('span','','projectBadges');badges.append(make('span',shared?'SHARED':'PRIVATE','projectBadge'),make('span',ready?'READY OFFLINE':'MEDIA MISSING','projectBadge '+(ready?'ready':'missing')));item.append(badges);
   item.onclick=async()=>{item.disabled=true;try{await selectProject(project.id);closeMenus()}catch(cause){error(cause.message)}finally{item.disabled=false}};
   list.append(item);
   const row=document.createElement('tr');row.dataset.projectId=project.id;row.classList.toggle('current',project.id===getCurrent()?.id);
   for(const value of [project.name,project.ownerEmail||'Local',shared?'SHARED':'PRIVATE',String(project.archetypeOrder?.length||0),ready?'Ready offline':'Media missing',project.updatedAt?new Date(project.updatedAt).toLocaleString():'—'])row.append(make('td',value));
   const actions=make('td','','libraryRowActions');
   const names={rename:['Rename','pencil'],duplicate:['Duplicate','copy'],share:[shared?'Make private':'Share','share-2'],delete:['Delete','trash-2'],export:['Export','download']};
   for(const action of projectActions(project,repository.email)){
    const [label,glyph]=names[action],control=make('button','','iconAction');control.innerHTML=icon(glyph);control.type='button';control.dataset.action=action;
    control.title=label+' '+project.name;control.dataset.tooltip=control.title;control.setAttribute('aria-label',control.title);
    control.onclick=async()=>{control.disabled=true;el('projectStatus').textContent='';try{await rowAction(action,project,control)}catch(cause){el('projectStatus').textContent=cause.message}finally{control.disabled=false}};
    actions.append(control);
   }
   row.append(actions);el('projectRows').append(row);
  }
  if(!projects.length)list.append(make('p','No projects yet.'));
 }
 async function refresh(){
  const version=++refreshVersion,next=await repository.listProjects();
  const ready=await Promise.all(next.map(async p=>[p.id,await repository.projectReadyOffline(p.id)]));
  if(version!==refreshVersion)return;projects=next;readiness=new Map(ready);render();await updateSync();
 }
 button.setAttribute('aria-controls','projectSwitcher');button.setAttribute('aria-haspopup','menu');
 avatar.setAttribute('aria-controls','accountMenu');avatar.setAttribute('aria-expanded','false');
 button.onclick=()=>{if(document.body.classList.contains('performMode'))return;const opening=switcher.hidden;closeMenus();if(!opening)return;closeEditing();switcher.hidden=false;button.setAttribute('aria-expanded','true');position(switcher,button);
  void refresh().then(()=>{position(switcher,button);(list.querySelector('[aria-checked=true]')||list.querySelector('button'))?.focus()}).catch(cause=>error(cause.message))};
 avatar.onclick=()=>{if(document.body.classList.contains('performMode'))return;const opening=account.hidden;closeMenus();if(opening){account.hidden=false;avatar.setAttribute('aria-expanded','true');position(account,avatar,true)}};
 el('manageLibrary').onclick=()=>{closeMenus();closeEditing();library.showModal();void refresh().catch(cause=>error(cause.message))};
 el('switcherNewProject').onclick=()=>{closeMenus();createProject()};
 // Capture prevents dropdown arrow keys from reaching live archetype shortcuts.
 document.addEventListener('keydown',event=>{
  const open=!switcher.hidden?switcher:!account.hidden?account:null;if(!open)return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeMenus();(open===switcher?button:avatar).focus();return}
  if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key)){
   event.preventDefault();event.stopImmediatePropagation();const items=[...open.querySelectorAll('button:not(:disabled)')],index=items.indexOf(document.activeElement);
   if(event.key==='Enter'||event.key===' '){(items[index]||items[0])?.click();return}
   const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(['ArrowUp','ArrowLeft'].includes(event.key)?-1:1)+items.length)%items.length;items[next]?.focus();
  }
 },true);
 document.addEventListener('click',event=>{if(!switcher.contains(event.target)&&!account.contains(event.target)&&!button.contains(event.target)&&!avatar.contains(event.target))closeMenus()});
 addEventListener('resize',()=>{if(!switcher.hidden)position(switcher,button);if(!account.hidden)position(account,avatar,true)});
 el('performBtn').addEventListener('click',closeMenus);
 const timer=setInterval(()=>{if(!document.hidden)void updateSync()},1500);addEventListener('pagehide',()=>clearInterval(timer));
 return {refresh,updateSync};
}
