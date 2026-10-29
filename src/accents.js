import { accentSourceId } from './source-registry.js';
export const ACCENT_DEFAULTS=Object.freeze({ratio:1.35,gapBeats:2});
export function normalizeAccentSettings(value){
 const number=(key,min,max)=>Number.isFinite(Number(value?.[key]))&&value?.[key]!=null?Math.max(min,Math.min(max,Number(value[key]))):ACCENT_DEFAULTS[key];
 return {ratio:number('ratio',1,4),gapBeats:number('gapBeats',.25,16)};
}
/** Event-time detector; history excludes the event currently being classified. */
export class AccentDetector{
 constructor(){this.history=new Map()}
 reset(id){if(id===undefined)this.history.clear();else this.history.delete(id)}
 process(event,settings=ACCENT_DEFAULTS,bpm=0){
  const {ratio,gapBeats}=normalizeAccentSettings(settings),time=event.timestamp;
  if(!Number.isFinite(time)||!Number.isFinite(event.intensity)||event.intensity<=0)return null;
  let state=this.history.get(event.type);if(!state){state={values:[],last:null};this.history.set(event.type,state)}
  // Old events cannot move the gap clock backwards or contaminate its median.
  if(state.last!==null&&time<state.last)return null;
  const sorted=state.values.slice().sort((a,b)=>a-b),n=sorted.length;
  const median=n?(sorted[Math.floor(n/2)]+sorted[Math.floor((n-1)/2)])/2:0;
  const gap=bpm>0?gapBeats*60/bpm:1;
  const accent=state.last===null||time-state.last>=gap||(n>0&&event.intensity>ratio*median);
  state.values.push(event.intensity);if(state.values.length>8)state.values.shift();state.last=time;
  return accent?{...event,type:accentSourceId(event.type)}:null;
 }
}
