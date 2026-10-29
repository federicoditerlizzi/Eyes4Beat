import { normalizeStructures } from './structure.js';
import { normalizeAccentSettings } from './accents.js';
import {withSourceDefinitions} from './source-registry.js';
import { migrateSourceControls, migrateSourceRecord } from './source-migration.js';
// Legacy ids are deterministic across clients until the next ordinary record write.
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
export function normalizeRoutingExtras(value){return {...value,structure:normalizeStructures(value?.structure),accent:normalizeAccentSettings(value?.accent)}}
export function normalizeMusicPresets(value){
 const used=new Set();
 return (Array.isArray(value)?value:[]).filter(p=>p&&typeof p.name==='string'&&p.name.trim()).map((preset,index)=>{
  const item=structuredClone(preset);
  if(typeof item.id!=='string'||!item.id||used.has(item.id)){
   let hash=2166136261;for(const char of JSON.stringify(canonical(preset))){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}
   item.id=`legacy-${(hash>>>0).toString(16)}-${index}`;while(used.has(item.id))item.id+='-dup';
  }
  used.add(item.id);return normalizeRoutingExtras(migrateSourceControls(item));
 });
}
export function normalizeRoutingRecord(record){return withSourceDefinitions(record?.origin?.sourceDefinitions,()=>normalizeRecord(record))}
function normalizeRecord(record){
 if(!record)return record;
 const musicPresets=normalizeMusicPresets(record.musicPresets);
 return {...migrateSourceRecord(record),musicPresets,activeRoutingPresetId:musicPresets.some(p=>p.id===record.activeRoutingPresetId)?record.activeRoutingPresetId:null,routingControls:record.routingControls?normalizeRoutingExtras(migrateSourceControls(record.routingControls)):null};
}
const fields=['enabled','solo','amounts','intensity','reactivity','targetEnabled','targetSolo','ctxPerf','globalReact','routing','structure','accent'];
export function routingSignature(value){return JSON.stringify(canonical(Object.fromEntries(fields.map(key=>[key,value?.[key]]))))}
export function routingPresetModified(current,preset){
 if(!preset)return false;
 // Older packages may omit controls they did not store. Compare their defined fields.
 function differs(a,b){if(b===undefined)return false;if(b&&typeof b==='object')return Object.keys(b).some(key=>differs(a?.[key],b[key]));return a!==b}
 return fields.some(key=>differs(current?.[key],preset[key]));
}
