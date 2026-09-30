import { icon } from '../icons.js';

// A shared menu over the existing select contract; storage and load handlers stay unchanged.
export function createPresetMenu(select,{label,onRename,onDelete}){
 const root=document.createElement('div');root.className='presetMenu';select.before(root);select.hidden=true;root.append(select);
 const trigger=document.createElement('button');trigger.type='button';trigger.className='presetMenuTrigger';trigger.setAttribute('aria-label',label);trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');root.append(trigger);trigger.id=select.id+'Trigger';document.querySelector('label[for="'+select.id+'"]')?.setAttribute('for',trigger.id);
 const menu=document.createElement('div');menu.className='presetMenuPopup';menu.id=select.id+'Menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label',label);menu.hidden=true;document.body.append(menu);trigger.setAttribute('aria-controls',menu.id);
 function close(focus=false){menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus()}
 function position(){const rect=trigger.getBoundingClientRect();menu.style.width=Math.min(Math.max(rect.width,280),innerWidth-32)+'px';menu.style.left=Math.max(16,Math.min(rect.left,innerWidth-menu.offsetWidth-16))+'px';menu.style.top=rect.bottom+4+'px';menu.style.maxHeight=Math.max(80,innerHeight-rect.bottom-20)+'px'}
 function render(){
  const selected=select.selectedOptions[0];const caption=document.createElement('span');caption.textContent=selected?.textContent||label;trigger.replaceChildren(caption);if(select.dataset.modified==='true'){const dot=document.createElement('span');dot.className='presetModified';dot.title='Modified';dot.setAttribute('aria-label','Modified');trigger.append(dot)}trigger.insertAdjacentHTML('beforeend',icon('chevron-down'));trigger.disabled=select.disabled;
  menu.replaceChildren();let group='',managed=0;
  for(const option of select.options){if(!option.value)continue;
   if(option.dataset.group&&option.dataset.group!==group){group=option.dataset.group;const title=document.createElement('div');title.className='presetMenuHeading';title.textContent=group;title.setAttribute('role','presentation');menu.append(title)}
   const row=document.createElement('div');row.className='presetMenuRow';row.dataset.value=option.value;row.setAttribute('role','presentation');
   const load=document.createElement('button');load.type='button';load.className='presetMenuLoad';load.textContent=option.textContent;load.setAttribute('role','menuitem');load.title='Load '+option.textContent;load.classList.toggle('selected',select.value===option.value);
   load.onclick=()=>{select.value=option.value;close(true);select.dispatchEvent(new Event('change',{bubbles:true}));refresh()};row.append(load);
   if(option.dataset.managed==='true'){
    managed++;
    for(const [glyph,action,callback] of [['pencil','Rename',onRename],['trash-2','Delete',onDelete]]){
     const b=document.createElement('button');b.type='button';b.className='iconAction presetMenuAction';b.innerHTML=icon(glyph);b.setAttribute('role','menuitem');b.setAttribute('aria-label',action+' '+option.textContent);b.title=action+' '+option.textContent;b.dataset.tooltip=action+' preset';
     b.onclick=async()=>{const value=option.value;close(true);try{await callback(value);refresh()}catch(error){alert(error.message)}};row.append(b);
    }
   }
   menu.append(row);
  }
  if(!managed){const empty=document.createElement('p');empty.className='presetMenuEmpty';empty.textContent='No project presets yet';menu.append(empty)}
 }
 function refresh(){const focused=document.activeElement,row=focused?.closest('.presetMenuRow'),value=row?.dataset.value,index=row?[...row.querySelectorAll('button')].indexOf(focused):-1;render();if(!menu.hidden){position();if(index>=0){const next=[...menu.querySelectorAll('.presetMenuRow')].find(el=>el.dataset.value===value);(next?.querySelectorAll('button')[index]||menu.querySelector('button')||trigger).focus()}}}
 function open(last=false){refresh();menu.hidden=false;trigger.setAttribute('aria-expanded','true');position();const items=menu.querySelectorAll('button');(last?items[items.length-1]:items[0])?.focus()}
 trigger.onclick=()=>menu.hidden?open():close();
 trigger.onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();e.stopPropagation();open(e.key==='ArrowUp')}};
 menu.onkeydown=e=>{
  e.stopPropagation();
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);return}
  if(e.key==='Tab'){close();return}
  const items=[...menu.querySelectorAll('button')],index=items.indexOf(document.activeElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus()}
 };
 document.addEventListener('click',e=>{if(!root.contains(e.target)&&!menu.contains(e.target))close()});
 addEventListener('resize',()=>close());document.addEventListener('scroll',e=>{if(!menu.contains(e.target))close()},true);
 new MutationObserver(refresh).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
 select.addEventListener('change',refresh);select.presetMenu={refresh,close};refresh();return select.presetMenu;
}
