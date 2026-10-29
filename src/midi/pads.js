import {PAD_RELEASE_MS} from '../event-envelope.js';
import {getSources,replaceSources} from '../source-registry.js';
export const MAX_MIDI_SLOTS=16;
export const defaultMidiSlots=()=>['KICK','SNARE','HAT','PERC'].map(name=>({id:'midi_pad_'+name.toLowerCase(),name,bindings:[],decayMs:PAD_RELEASE_MS,velocityCurve:'linear'}));
const validBinding=b=>b&&Number.isInteger(b.note)&&b.note>=0&&b.note<=127&&Number.isInteger(b.channel)&&b.channel>=1&&b.channel<=16;
const key=b=>b.channel+':'+b.note;
export function normalizeMidiSlots(value){
 if(value==null)return defaultMidiSlots();
 if(!Array.isArray(value)||value.length>MAX_MIDI_SLOTS)throw new Error('Maximum 16 MIDI slots');
 const ids=new Set(),notes=new Set();
 return value.map(slot=>{
  if(!slot||typeof slot.id!=='string'||!/^midi_pad_[a-zA-Z0-9_-]+$/.test(slot.id)||ids.has(slot.id)||typeof slot.name!=='string'||!slot.name.trim()||slot.name.trim().length>40||!Array.isArray(slot.bindings)||slot.bindings.length>2048)throw new Error('Invalid MIDI slot');
  ids.add(slot.id);const bindings=[];
  for(const b of slot.bindings){if(!validBinding(b))throw new Error('Invalid MIDI note binding');if(notes.has(key(b)))throw new Error('MIDI note is already bound');notes.add(key(b));bindings.push({note:b.note,channel:b.channel})}
  return {id:slot.id,name:slot.name.trim(),bindings,decayMs:slot.decayMs!=null&&Number.isFinite(Number(slot.decayMs))?Math.max(30,Math.min(600,Number(slot.decayMs))):PAD_RELEASE_MS,velocityCurve:['linear','soft','hard'].includes(slot.velocityCurve)?slot.velocityCurve:'linear'};
 });
}
export const midiSourceDefinitions=slots=>normalizeMidiSlots(slots).map(s=>({id:s.id,label:'MIDI · '+s.name,kind:'event',group:'midi-pad'}));
export function syncMidiSources(slots){replaceSources([...getSources().filter(s=>s.group!=='midi-pad'&&s.group!=='accent'),...midiSourceDefinitions(slots)])}
export function mergeMidiSlots(existing,incoming){
 if(incoming===undefined)return normalizeMidiSlots(existing);
 const result=normalizeMidiSlots(existing),added=normalizeMidiSlots(incoming);
 for(const slot of added){
  let target=result.find(s=>s.id===slot.id);if(!target){target={...slot,bindings:[]};result.push(target)}
  target.decayMs=slot.decayMs;target.velocityCurve=slot.velocityCurve;
  for(const binding of slot.bindings){for(const other of result)other.bindings=other.bindings.filter(b=>key(b)!==key(binding));target.bindings.push(binding)}
 }
 return normalizeMidiSlots(result);
}
export function midiVelocity(velocity,curve='linear'){const x=Math.max(0,Math.min(127,velocity))/127;return curve==='soft'?Math.sqrt(x):curve==='hard'?x*x:x}
export function noteLabel({note,channel}){return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][note%12]+(Math.floor(note/12)-1)+' ('+note+') · CH '+channel}
export class MidiPads{
 constructor(){this.projectId=null;this.slots=[];this.learning=null;this.pending=null;this.hits={};this.revision=0;this.serial=0}
 load(projectId,slots){this.projectId=projectId;this.set(projectId?slots:[]);this.hits={}}
 set(slots){this.slots=normalizeMidiSlots(slots);this.learning=null;this.pending=null;this.revision++;for(const id of Object.keys(this.hits))if(!this.slots.some(s=>s.id===id))delete this.hits[id]}
 learn(id){if(id!==null&&!this.slots.some(s=>s.id===id))throw new Error('MIDI slot not found');this.learning=id;this.pending=null}
 bind(slotId,binding,move=false){
  const target=this.slots.find(s=>s.id===slotId);if(!target)return false;
  const other=this.slots.find(s=>s.id!==slotId&&s.bindings.some(b=>key(b)===key(binding)));
  if(other&&!move)return false;
  for(const slot of this.slots)slot.bindings=slot.bindings.filter(b=>key(b)!==key(binding));
  target.bindings.push({...binding});this.revision++;return true;
 }
 confirm(token,accept){const p=this.pending;if(!p||p.token!==token)return false;this.pending=null;if(accept)return this.bind(p.slotId,p.binding,true);return false}
 receive(message){
  if(message.type!=='note-on'||message.velocity<=0)return null;
  const binding={note:message.note,channel:message.channel};
  if(this.learning){
   const slotId=this.learning;this.learning=null;
   const other=this.slots.find(s=>s.id!==slotId&&s.bindings.some(b=>key(b)===key(binding)));
   if(other)this.pending={token:++this.serial,slotId,fromId:other.id,binding};else this.bind(slotId,binding);
  }
  const slot=this.slots.find(s=>s.bindings.some(b=>key(b)===key(binding)));if(!slot)return null;
  const event={type:slot.id,intensity:midiVelocity(message.velocity,slot.velocityCurve),timestamp:message.timestamp/1000};
  this.hits[slot.id]={...event,serial:++this.serial};return event;
 }
 values(now){return Object.fromEntries(this.slots.map(s=>{const hit=this.hits[s.id];return [s.id,hit?hit.intensity*Math.exp(-Math.max(0,now-hit.timestamp*1000)/s.decayMs):0]}))}
 snapshot(now){return {projectId:this.projectId,slots:this.slots,revision:this.revision,learning:this.learning,pending:this.pending,values:this.values(now),flashes:Object.fromEntries(this.slots.map(s=>[s.id,this.hits[s.id]?Math.exp(-Math.max(0,now-this.hits[s.id].timestamp*1000)/140):0]))}}
 clear(){this.hits={}}
}
