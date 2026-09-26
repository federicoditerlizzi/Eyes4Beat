// The wire accepts only data. No callbacks, DOM objects, handles or shared references.
export const PROTOCOL_VERSION=1;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const number=v=>typeof v==='number'&&Number.isFinite(v);
const id=v=>typeof v==='string'&&v.length>0;
const range=(v,a,b)=>number(v)&&v>=a&&v<=b;
const flags=v=>object(v)&&Object.values(v).every(x=>typeof x==='boolean');
const values=v=>object(v)&&Object.values(v).every(number);
const controls=v=>object(v)&&['enabled','solo','targetEnabled','targetSolo'].every(k=>flags(v[k]))&&['amounts','intensity','reactivity'].every(k=>values(v[k]))&&range(v.ctxPerf,0,1)&&number(v.globalReact);
const media=v=>object(v)&&id(v.mediaId)&&typeof v.mime==='string';
const record=v=>object(v)&&id(v.id)&&id(v.projectId)&&Array.isArray(v.media)&&v.media.every(media);
const project=v=>v===null||(object(v)&&id(v.id)&&Array.isArray(v.archetypeOrder)&&v.archetypeOrder.every(id));
const patch=v=>object(v)&&Object.keys(v).every(k=>['look','routingMap','imageConfig','musicPresets','name','origin'].includes(k))&&
 (v.name===undefined||id(v.name))&&['look','routingMap','imageConfig','origin'].every(k=>v[k]===undefined||object(v[k]))&&
 (v.musicPresets===undefined||Array.isArray(v.musicPresets));
export const COMMANDS={
 loadProject:p=>project(p.project)&&Array.isArray(p.records)&&p.records.every(record)&&id(p.cacheName)&&(p.preferredId==null||id(p.preferredId))&&(p.imagePositions===undefined||Array.isArray(p.imagePositions)&&p.imagePositions.every(v=>id(v.id)&&Number.isInteger(v.index)&&v.index>=0)),
 updateArchetype:p=>id(p.id)&&patch(p.patch),
 selectArchetype:p=>id(p.id),
 imageStep:p=>id(p.id)&&[-1,1].includes(p.direction)&&['manual','timed','event'].includes(p.trigger||'manual'),
 imageGoto:p=>id(p.id)&&Number.isInteger(p.index)&&p.index>=0&&['manual','timed','event'].includes(p.trigger||'manual'),
 setControls:p=>controls(p.controls),setTransition:p=>['smooth','cut'].includes(p.mode),
 audioLoad:p=>p.blob instanceof Blob&&typeof p.name==='string',audioPlay:()=>true,audioPause:()=>true,
 audioSeek:p=>range(p.fraction,0,1),audioVolume:p=>range(p.value,0,1),audioMute:p=>typeof p.value==='boolean',
 setInput:p=>['file','live'].includes(p.mode)&&(p.device===undefined||typeof p.device==='string')&&(p.trim===undefined||range(p.trim,-60,24)),
 setTrim:p=>range(p.value,-60,24),enumerateInputs:()=>true,calibrate:()=>true,clearCalibration:()=>true,
 setSafety:p=>['blackout','panic','liveLock'].includes(p.control)&&typeof p.value==='boolean',
 setRenderScale:p=>range(p.value,.5,1),
 setQuality:p=>['off','low','high'].includes(p.value),setDiagnostics:p=>typeof p.enabled==='boolean',
 audioRestore:p=>['file','live'].includes(p.mode)&&(p.blob===undefined||p.blob instanceof Blob)&&number(p.currentTime)&&p.currentTime>=0&&typeof p.paused==='boolean'&&range(p.volume,0,1)&&typeof p.muted==='boolean',
};
export function assertData(value,seen=new Set()){
 if(value===null||['string','boolean','undefined'].includes(typeof value))return;
 if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('Non-finite wire number');return}
 if(typeof value!=='object')throw new TypeError('Messages must contain data only');
 if(value instanceof Blob||ArrayBuffer.isView(value)||value instanceof ArrayBuffer)return;
 if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw new TypeError('Unsupported wire object');
 if(seen.has(value))throw new TypeError('Cyclic wire data');seen.add(value);
 for(const item of Object.values(value))assertData(item,seen);seen.delete(value);
}
export function validateCommand(message){
 assertData(message);
 if(!object(message)||message.protocol!==PROTOCOL_VERSION||!Number.isSafeInteger(message.seq)||message.seq<1||!Object.hasOwn(COMMANDS,message.type)||!object(message.payload)||!COMMANDS[message.type](message.payload))throw new TypeError('Invalid engine command');
 return message;
}
export function command(seq,type,payload={}){return validateCommand({protocol:PROTOCOL_VERSION,seq,type,payload})}
export function snapshot(version,appliedSeq,state){if(!Number.isSafeInteger(version)||version<1||!Number.isSafeInteger(appliedSeq)||appliedSeq<0)throw new TypeError('Invalid snapshot version');return {protocol:PROTOCOL_VERSION,type:'state',version,appliedSeq,state:structuredClone(state)}}
// Buffer reordered delivery and await async commands before applying the next one.
export function createCommandQueue(apply,onApplied=()=>{}){
 let next=1,running=false,inFlight=null;const pending=new Map();
 async function drain(){if(running)return;running=true;try{while(pending.has(next)){
  const item=pending.get(next);pending.delete(next);inFlight=next;
  try{await apply(item.message);onApplied(next);item.resolve()}catch(error){onApplied(next);item.reject(error)}inFlight=null;next++;
 }}finally{running=false}}
 return message=>{validateCommand(message);if(message.seq<next||message.seq===inFlight||pending.has(message.seq))return Promise.reject(new Error('Duplicate or stale command sequence'));
  return new Promise((resolve,reject)=>{pending.set(message.seq,{message:structuredClone(message),resolve,reject});void drain()});};
}
