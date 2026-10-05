import {icon} from '../icons.js';
import {noteLabel,MAX_MIDI_SLOTS} from '../midi/pads.js';
export function createMidiPadsUi(send){
 const root=document.getElementById('midiPads');let latest=null,signature='';
 const button=(text,title,action,iconName)=>{const b=document.createElement('button');b.type='button';b.title=title;b.dataset.tooltip=title;b.setAttribute('aria-label',title);if(iconName){b.className='iconAction';b.innerHTML=icon(iconName)}else b.textContent=text;b.onclick=action;return b};
 const change=slots=>send('setMidiSlots',{projectId:latest.projectId,slots});
 function render(pads,midi){
  if(!pads)return;latest=pads;
  const next=JSON.stringify([pads.projectId,pads.slots,pads.learning,pads.pending,midi.connected,midi.supported]);
  if(next!==signature){signature=next;root.replaceChildren();
   if(!pads.projectId){root.textContent='Open a project to configure MIDI pads.';return}
   for(const slot of pads.slots){
    const row=document.createElement('div');row.className='midiPad';row.dataset.slot=slot.id;
    const header=document.createElement('div');header.className='midiPadHeader';
    const flash=document.createElement('span');flash.className='midiPadFlash';flash.title='Pad activity';
    const name=document.createElement('input');name.value=slot.name;name.maxLength=40;name.setAttribute('aria-label','MIDI slot name');name.title='Rename MIDI slot';name.onchange=()=>{if(name.value.trim())change(latest.slots.map(s=>s.id===slot.id?{...s,name:name.value.trim()}:s));else name.value=slot.name};
    const learning=pads.learning===slot.id;
    const learn=button(learning?'CANCEL':'LEARN',learning?'Cancel MIDI Learn':'Learn the next Note On',()=>send('learnMidiSlot',{projectId:latest.projectId,slotId:learning?null:slot.id}));learn.disabled=!midi.connected&&!learning;learn.title=learn.disabled?'Connect a MIDI input to learn a note':learn.title;learn.dataset.tooltip=learn.title;
    header.append(flash,name,learn,button('','Delete MIDI slot',()=>{if(confirm('Delete '+slot.name+' and its bindings?'))change(latest.slots.filter(s=>s.id!==slot.id))},'trash-2'));row.append(header);
    const bindings=document.createElement('div');bindings.className='midiBindings';
    if(!slot.bindings.length)bindings.textContent=learning?'Play a pad…':'No notes learned';
    for(const binding of slot.bindings){const item=document.createElement('span');item.append(document.createTextNode(noteLabel(binding)),button('','Remove '+noteLabel(binding),()=>change(latest.slots.map(s=>s.id===slot.id?{...s,bindings:s.bindings.filter(b=>b.note!==binding.note||b.channel!==binding.channel)}:s)),'x'));bindings.append(item)}
    row.append(bindings);root.append(row);
   }
   if(pads.pending){const p=pads.pending,box=document.createElement('div');box.className='inspectorBanner';const from=pads.slots.find(s=>s.id===p.fromId),to=pads.slots.find(s=>s.id===p.slotId);box.textContent=noteLabel(p.binding)+' is bound to '+from?.name+'. Move to '+to?.name+'?';for(const [label,accept] of [['MOVE',true],['CANCEL',false]])box.append(button(label,label==='MOVE'?'Confirm moving this binding':'Keep the existing binding',()=>send('confirmMidiBinding',{projectId:latest.projectId,token:p.token,accept})));root.append(box)}
   const add=button('ADD SLOT','Add a named MIDI pad slot',()=>change([...latest.slots,{id:'midi_pad_'+crypto.randomUUID(),name:'PAD '+(latest.slots.length+1),bindings:[]}]));add.disabled=pads.slots.length>=MAX_MIDI_SLOTS;if(add.disabled)add.title=add.dataset.tooltip='Maximum 16 MIDI slots';root.append(add);
  }
  for(const row of root.querySelectorAll('[data-slot]'))row.querySelector('.midiPadFlash').style.opacity=String(.15+.85*(pads.flashes?.[row.dataset.slot]||0));
 }
 return {render};
}
