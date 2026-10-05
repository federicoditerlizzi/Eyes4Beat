import {getSource} from './source-registry.js';
const aliases={energy:'level',drive:'low',tension:'motion',density:'full',open:'full',boombap:null};
export function migrateSourceId(id){const key=Object.hasOwn(aliases,id)?aliases[id]:id;return key&&getSource(key)?key:'none'}
export function migrateSourceMap(map){
 const out={};
 // A canonical entry wins a collision; legacy collisions keep the strongest weight.
 for(const [source,targets] of Object.entries(map||{})){
  const id=migrateSourceId(source);if(id==='none')continue;out[id]??={};
  for(const [target,weight] of Object.entries(targets||{})){const v=Number(weight)*(source==='open'?-1:1);if(!Number.isFinite(v))continue;
   const canonical=Number(map[id]?.[target]);if(source!==id&&Number.isFinite(canonical)&&canonical!==0)continue;
   if((source===id&&v!==0)||out[id][target]===undefined||Math.abs(v)>Math.abs(out[id][target]))out[id][target]=v;
  }
 }
 return out;
}
export function migrateSourceControls(value){
 if(!value)return value;const result=structuredClone(value);
 for(const field of ['enabled','solo','amounts'])if(value[field]){
  const out={};
  for(const [source,v] of Object.entries(value[field])){const id=migrateSourceId(source);if(id==='none')continue;if(source===id||!Object.hasOwn(out,id))out[id]=field==='amounts'&&source==='open'?-Number(v):v}
  result[field]=out;
 }
 if(value.routing)result.routing=migrateSourceMap(value.routing);
 return result;
}
export function migrateSourceRecord(value){
 if(!value)return value;const result={...value};
 if(value.routingMap)result.routingMap=migrateSourceMap(value.routingMap);
 if(value.routingControls)result.routingControls=migrateSourceControls(value.routingControls);
 if(value.imageConfig)result.imageConfig={...value.imageConfig,source:migrateSourceId(value.imageConfig.source)};
 if(value.look?.particles?.burst)result.look={...value.look,particles:{...value.look.particles,burst:{...value.look.particles.burst,trigger:migrateSourceId(value.look.particles.burst.trigger)}}};
 if(value.origin?.startingRoutingMap)result.origin={...value.origin,startingRoutingMap:migrateSourceMap(value.origin.startingRoutingMap)};
 return result;
}
