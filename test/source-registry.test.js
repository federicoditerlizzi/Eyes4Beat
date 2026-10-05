import test from 'node:test';
import assert from 'node:assert/strict';
import {getSources,registerSource,unregisterSource,sourceIds,subscribeSources,withSourceDefinitions} from '../src/source-registry.js';
import {migrateSourceControls,migrateSourceMap,migrateSourceId} from '../src/source-migration.js';
import {normalizeRoutingRecord,normalizeMusicPresets} from '../src/routing-presets.js';
import {blankMap} from '../src/config.js';
import {assignedSource,assignTarget} from '../src/routing.js';
import {normalizeRoutingMap,defaultImageConfig} from '../src/library/runtime.js';
import {normalizeLook} from '../src/looks.js';
import {normalizeImageConfigStore,classifyImageTrigger} from '../src/image-sequencer.js';
import {prepareImportedArchetype} from '../src/library/package-mapping.js';
const imageConfig=source=>normalizeImageConfigStore({configs:[{...defaultImageConfig(1),mode:'mapped',source}]},[defaultImageConfig(1)]).configs[0];

test('registry drives routing, preset controls, sequencing and burst options; unregister drops assignments',()=>{
 const before=getSources();let notifications=0;const stop=subscribeSources(()=>notifications++);
 try{
  registerSource({id:'testPad',label:'Test pad',kind:'event',group:'midi'});
  registerSource({id:'testFader',label:'Test fader',kind:'continuous',group:'midi'});
  assert.ok(sourceIds.includes('testPad'));assert.equal(getSources().find(s=>s.id==='testPad').label,'Test pad');
  const map=blankMap();assignTarget(map,'pulse','testPad',.7);assert.equal(assignedSource(normalizeRoutingMap(map),'pulse'),'testPad');
  const preset=normalizeMusicPresets([{name:'External',routing:map,enabled:{testPad:true},solo:{testPad:true},amounts:{testPad:.6}}])[0];
  assert.equal(preset.amounts.testPad,.6);assert.equal(preset.enabled.testPad,true);assert.equal(preset.solo.testPad,true);
  assert.equal(imageConfig('testPad').source,'testPad');assert.equal(classifyImageTrigger({mode:'mapped',source:'testPad'}),'event');
  assert.equal(classifyImageTrigger({mode:'mapped',source:'testFader'}),'timed');
  const look={particles:{burst:{trigger:'testPad'}}};assert.equal(normalizeLook(look).particles.burst.trigger,'testPad');
  unregisterSource('testPad');assert.equal(assignedSource(normalizeRoutingMap(map),'pulse'),null);
  assert.equal(imageConfig('testPad').source,'none');assert.equal(normalizeLook(look).particles.burst.trigger,'none');assert.equal(normalizeMusicPresets([preset])[0].amounts.testPad,undefined);
  assert.equal(notifications,3);
 }finally{stop();unregisterSource('testPad');unregisterSource('testFader')}
 assert.deepEqual(getSources(),before);
});

test('legacy ids migrate, open inverts full, collisions prefer nonzero canonical data',()=>{
 const map=migrateSourceMap({energy:{pulse:.5},drive:{dist:.4},tension:{zoom:.6},density:{parts:.7},open:{luma:.8,parts:.3},boombap:{sat:1},unknown:{glow:1},full:{glow:0}});
 assert.deepEqual(map,{level:{pulse:.5},low:{dist:.4},motion:{zoom:.6},full:{parts:.7,luma:-.8,glow:0}});
 assert.equal(migrateSourceMap({open:{parts:.7},full:{parts:.2}}).full.parts,.2);
 const controls=migrateSourceControls({enabled:{energy:false,open:true,boombap:true},solo:{drive:true},amounts:{open:.8,tension:.5},routing:{open:{pulse:.5}}});
 assert.deepEqual(controls.enabled,{level:false,full:true});assert.deepEqual(controls.solo,{low:true});assert.deepEqual(controls.amounts,{full:-.8,motion:.5});assert.equal(controls.routing.full.pulse,-.5);
 assert.equal(migrateSourceId('boombap'),'none');assert.equal(migrateSourceId('notRegistered'),'none');
});

test('records and v1/v2/v3 import migrate source ids including preset controls',()=>{
 const legacy={name:'Legacy',routingMap:{open:{zoom:.3},energy:{pulse:.4}},imageConfig:{...defaultImageConfig(0),source:'boombap'},look:{particles:{burst:{trigger:'boombap'}}},musicPresets:[{name:'Saved',routing:{drive:{dist:.5}},amounts:{open:.8},enabled:{energy:true},solo:{tension:true}}],routingControls:{amounts:{density:.3}},media:[]};
 const record=normalizeRoutingRecord(legacy);assert.equal(record.routingMap.full.zoom,-.3);assert.equal(record.imageConfig.source,'none');assert.equal(record.look.particles.burst.trigger,'none');assert.equal(record.routingControls.amounts.full,.3);
 for(const version of [1,2,3]){const imported=prepareImportedArchetype(legacy,version);assert.equal(imported.routingMap.level.pulse,.4);assert.equal(imported.routingMap.full.zoom,-.3);assert.equal(imported.imageConfig.source,'none');assert.equal(imported.musicPresets[0].routing.low.dist,.5);assert.equal(imported.musicPresets[0].amounts.full,-.8);assert.equal(imported.musicPresets[0].solo.motion,true)}
 assert.deepEqual(normalizeRoutingRecord(record),record,'migration idempotent');
});

test('server can validate record-scoped extension definitions without leaking into the registry',()=>{
 const before=getSources();const result=withSourceDefinitions([{id:'externalPad',label:'Pad',kind:'event',group:'midi'}],()=>normalizeRoutingRecord({musicPresets:[{name:'Pad',amounts:{externalPad:.6}}],routingMap:{externalPad:{pulse:1}}}));
 assert.equal(result.routingMap.externalPad.pulse,1);assert.equal(result.musicPresets[0].amounts.externalPad,.6);assert.deepEqual(getSources(),before);
 assert.throws(()=>withSourceDefinitions([{id:'none'}],()=>{}));assert.deepEqual(getSources(),before);
});
