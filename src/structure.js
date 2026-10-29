import { getSource } from './source-registry.js';
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const finite=(v,fallback)=>v!==null&&v!==''&&Number.isFinite(Number(v))?Number(v):fallback;
// Values are offsets, except the amplitude multiplier and discrete absolute choices.
export const STRUCTURE_PARAMETERS=Object.freeze({
 'kaleido.segments':{label:'Kaleido segments',min:2,max:16,discrete:true,initial:[6,8]},
 'kaleido.angle':{label:'Kaleido angle offset (deg)',min:-180,max:180},
 'distortion.multiplier':{label:'Distortion amplitude multiplier',min:0,max:3,neutral:1},
 'distortion.angle':{label:'Distortion angle offset (deg)',min:-180,max:180},
 'spiral.amount':{label:'Spiral amount offset',min:0,max:1.5},
 'spiral.direction':{label:'Spiral direction (−1 / +1)',min:-1,max:1,discrete:true,direction:true},
 'rotation.direction':{label:'Rotation direction (−1 / +1)',min:-1,max:1,discrete:true,direction:true},
 'feedback.zoom':{label:'Feedback zoom offset',min:-.01,max:.01},
 'feedback.rotate':{label:'Feedback rotation offset (deg/frame)',min:-3,max:3},
 'tiles.seed':{label:'Tile permutation seed',min:0,max:95,discrete:true},
});
export const STRUCTURE_CURVES=['linear','smoothstep','ease-in','ease-out'];
export function structureEase(x,curve='smoothstep'){
 x=clamp(x,0,1);return curve==='linear'?x:curve==='ease-in'?x*x:curve==='ease-out'?1-(1-x)**2:x*x*(3-2*x);
}
function choice(value,p,min=p.min,max=p.max){
 const v=clamp(value,min,max);return p.direction?(v<0?-1:1):p.discrete?Math.round(v):v;
}
export function normalizeStructures(rows){
 const ids=new Set();return (Array.isArray(rows)?rows:[]).slice(0,8).filter(row=>row&&Object.hasOwn(STRUCTURE_PARAMETERS,row.parameter)).map((row,i)=>{
  const p=STRUCTURE_PARAMETERS[row.parameter],initial=p.initial||[p.min,p.max];
  let min=clamp(finite(row.min,initial[0]),p.min,p.max),max=clamp(finite(row.max,initial[1]),p.min,p.max);
  if(min>max)[min,max]=[max,min];min=choice(min,p);max=choice(max,p);
  let id=typeof row.id==='string'&&row.id?row.id:'structure-'+i;while(ids.has(id))id+='-copy';ids.add(id);
  const values=(Array.isArray(row.values)?row.values:[min,max]).slice(0,32).filter(v=>v!==null&&v!==''&&Number.isFinite(Number(v))).map(v=>choice(Number(v),p,min,max));
  const rawStep=clamp(finite(row.step,(max-min)/4),0,p.max-p.min);
  const step=rawStep===0?0:p.direction?2:p.discrete?Math.max(1,Math.round(rawStep)):rawStep;
  return {id,trigger:getSource(row.trigger)?.kind==='event'?row.trigger:'none',parameter:row.parameter,min,max,
   mode:['random-walk','random','cycle'].includes(row.mode)?row.mode:'cycle',
   step,values:values.length?values:[min,max],
   durationMs:clamp(finite(row.durationMs,300),50,2000),curve:STRUCTURE_CURVES.includes(row.curve)?row.curve:'smoothstep'};
 });
}
export function structureFieldRelevant(row,key){return key==='step'?row.mode==='random-walk':key==='values'?row.mode==='cycle':true}
function baseValue(parameter,look){
 return parameter==='kaleido.segments'?look.kaleido.segments:parameter==='rotation.direction'?(look.rotation.direction==='ccw'?-1:1):parameter==='spiral.direction'?1:STRUCTURE_PARAMETERS[parameter].neutral??0;
}
function sample(state,row,now){
 const x=clamp((now-state.at)/row.durationMs,0,1),p=STRUCTURE_PARAMETERS[row.parameter];
 if(p.discrete){
  const dip=row.parameter==='kaleido.segments'&&(state.from!==state.to||state.dipStart<1)?(x<.5?state.dipStart*(1-structureEase(x*2,row.curve)):structureEase((x-.5)*2,row.curve)):1;
  return {value:x<.5?state.from:state.to,dip};
 }
 return {value:state.from+(state.to-state.from)*structureEase(x,row.curve),dip:1};
}
export class StructureRuntime{
 constructor(random=Math.random){this.random=random;this.archetypes=new Map()}
 reset(){this.archetypes.clear()}
 sync(id,rows,look){
  const config=normalizeStructures(rows),signature=JSON.stringify(config);let state=this.archetypes.get(id);
  if(!state){state={signature,rows:config,states:new Map()};this.archetypes.set(id,state)}
  else if(state.signature!==signature){
   const prior=new Map(state.rows.map(row=>[row.id,JSON.stringify(row)]));
   for(const key of state.states.keys())if(prior.get(key)!==JSON.stringify(config.find(row=>row.id===key)))state.states.delete(key);
   state.signature=signature;state.rows=config;
  }
  return state;
 }
 trigger(id,rows,look,event,now){
  const state=this.sync(id,rows,look);
  for(const row of state.rows){if(row.trigger!==event.type)continue;
   const p=STRUCTURE_PARAMETERS[row.parameter],previous=state.states.get(row.id),base=baseValue(row.parameter,look);
   const current=previous?sample(previous,row,now):{value:base,dip:1};
   let next,cursor=previous?.cursor??-1;
   if(row.mode==='cycle'){cursor=(cursor+1)%row.values.length;next=row.values[cursor]}
   else if(row.mode==='random-walk')next=(previous?.to??base)+(this.random()<.5?-1:1)*row.step;
   else next=p.direction?(this.random()<.5?row.min:row.max):p.discrete?row.min+Math.floor(this.random()*(row.max-row.min+1)):row.min+this.random()*(row.max-row.min);
   state.states.set(row.id,{from:current.value,to:choice(next,p,row.min,row.max),at:now,cursor,dipStart:current.dip,returning:false});
  }
 }
 release(id,look,now){
  const state=this.archetypes.get(id);if(!state)return;
  for(const row of state.rows){const previous=state.states.get(row.id);if(!previous)continue;const current=sample(previous,row,now);
   state.states.set(row.id,{...previous,from:current.value,to:baseValue(row.parameter,look),at:now,dipStart:current.dip,returning:true});
  }
 }
 apply(id,rows,base,now){
  const state=this.sync(id,rows,base);if(!state.states.size)return base;
  const look=structuredClone(base);look.structure={spiralAmount:0,spiralDirection:1,tileSeed:0};look.kaleido.structuralDip=1;look.kaleido.angleOffset=0;
  for(const row of state.rows){const s=state.states.get(row.id);if(!s)continue;
   if(s.returning&&now>=s.at+row.durationMs){state.states.delete(row.id);continue}
   const {value,dip}=sample(s,row,now);
   switch(row.parameter){
    case 'kaleido.segments':look.kaleido.segments=value;look.kaleido.structuralDip=Math.min(look.kaleido.structuralDip,dip);break;
    case 'kaleido.angle':look.kaleido.angleOffset=clamp(look.kaleido.angleOffset+value,-180,180);break;
    case 'distortion.multiplier':look.distortion.amplitude=clamp(look.distortion.amplitude*value,0,.12);break;
    case 'distortion.angle':look.distortion.angle=clamp(look.distortion.angle+value,-180,180);break;
    case 'spiral.amount':look.structure.spiralAmount=clamp(look.structure.spiralAmount+value,0,1.5);break;
    case 'spiral.direction':look.structure.spiralDirection=value;break;
    case 'rotation.direction':look.rotation.direction=value<0?'ccw':'cw';break;
    case 'feedback.zoom':look.feedback.zoom=clamp(look.feedback.zoom+value,-.01,.01);break;
    case 'feedback.rotate':look.feedback.rotate=clamp(look.feedback.rotate+value,-3,3);break;
    case 'tiles.seed':look.structure.tileSeed=value;break;
   }
  }
  return state.states.size?look:base;
 }
 snapshot(id,rows,look,now){
  const state=this.sync(id,rows,look);return state.rows.map(row=>{const s=state.states.get(row.id);return {id:row.id,parameter:row.parameter,...(s?sample(s,row,now):{value:baseValue(row.parameter,look),dip:1}),target:s?.to??baseValue(row.parameter,look)}});
 }
}
