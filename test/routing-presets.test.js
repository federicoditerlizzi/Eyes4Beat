import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMusicPresets,normalizeRoutingRecord,routingPresetModified} from '../src/routing-presets.js';
import {buildProjectRuntime} from '../src/library/runtime.js';
import {prepareImportedArchetype} from '../src/library/package-mapping.js';

test('legacy preset ids migrate deterministically, retain ids through edits and avoid duplicates',()=>{
 const old=[{name:'A',amounts:{energy:.5}},{name:'A',amounts:{energy:.5}}];
 const a=normalizeMusicPresets(old);assert.deepEqual(a,normalizeMusicPresets(structuredClone(old)));assert.notEqual(a[0].id,a[1].id);
 a[0].name='Renamed';assert.equal(normalizeMusicPresets(a)[0].id,a[0].id);
 assert.equal(new Set(normalizeMusicPresets([a[0],a[0]]).map(p=>p.id)).size,2);
});
test('active id survives runtime reload and archetype order changes; missing active id clears',()=>{
 const preset={id:'preset-a',name:'A',routing:{energy:{pulse:1}}};
 const a={id:'a',projectId:'p',name:'A',media:[],musicPresets:[preset],activeRoutingPresetId:preset.id,routingMap:preset.routing};
 const b={...a,id:'b',activeRoutingPresetId:null};
 for(const order of [['a','b'],['b','a']]){
  const runtime=buildProjectRuntime({id:'p',archetypeOrder:order},structuredClone([a,b]));
  assert.equal(runtime.archetypes[runtime.idToIndex.get('a')].activeRoutingPresetId,preset.id);
 }
 assert.equal(normalizeRoutingRecord({...a,musicPresets:[]}).activeRoutingPresetId,null);
});
test('modified derives only from stored preset data after reload, independent of metadata and key order',()=>{
 const preset={id:'a',name:'A',amounts:{energy:.5,kick:1},routing:{energy:{pulse:1}}};
 const current=structuredClone(preset);delete current.id;delete current.name;current.amounts={kick:1,energy:.5};
 assert.equal(routingPresetModified(current,structuredClone(preset)),false);
 current.amounts.energy=.7;assert.equal(routingPresetModified(current,structuredClone(preset)),true);
 assert.equal(routingPresetModified(current,{...preset,amounts:current.amounts}),false);
 assert.equal(routingPresetModified(current,null),false);
});
test('old and current package imports preserve routing presets and selected id',()=>{
 const source={name:'A',media:[],musicPresets:[{name:'Old'}],look:{},routingMap:{},imageConfig:{}};
 const old=prepareImportedArchetype(source,3);assert.ok(old.musicPresets[0].id);assert.equal(old.activeRoutingPresetId,null);
 const imported=prepareImportedArchetype({...source,musicPresets:old.musicPresets,activeRoutingPresetId:old.musicPresets[0].id},3);
 assert.equal(imported.activeRoutingPresetId,old.musicPresets[0].id);
});
