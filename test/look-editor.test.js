import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_GROUPS, resetLookGroup, startingLook, readGroupState } from '../src/ui/look-editor.js';
import { NEUTRAL_LOOK, FACTORY_LOOKS } from '../src/looks.js';
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}};
test('LOOK editor exposes every model leaf exactly once in the requested groups',()=>{
 assert.deepEqual(LOOK_GROUPS.map(g=>g[0]),['color','distortion','particles','bloom','pulse','rotation','frame']);
 const paths=LOOK_GROUPS.flatMap(([group,,,primary,fields])=>{
  assert.ok(fields.filter(([key,,fieldGroup=group])=>fieldGroup===group&&primary.includes(key)).length<=3);
  return fields.map(([key,,fieldGroup=group])=>fieldGroup+'.'+key);
 });
 const leaves=(object,path='')=>Object.entries(object).flatMap(([key,value])=>typeof value==='object'?leaves(value,path+key+'.'):[path+key]);
 assert.deepEqual(paths.slice().sort(),leaves(NEUTRAL_LOOK).sort());
 assert.equal(paths.length,new Set(paths).size);
});
test('group reset isolates changes and includes vignette and particle burst',()=>{
 const edited=structuredClone(NEUTRAL_LOOK);edited.color.gain=1.8;edited.vignette.amount=.8;edited.bloom.base=.5;edited.particles.burst.amount=99;
 const color=resetLookGroup(edited,NEUTRAL_LOOK,'color');
 assert.deepEqual(color.color,NEUTRAL_LOOK.color);assert.deepEqual(color.vignette,NEUTRAL_LOOK.vignette);assert.equal(color.bloom.base,.5);
 assert.deepEqual(resetLookGroup(edited,NEUTRAL_LOOK,'particles').particles,NEUTRAL_LOOK.particles);assert.equal(edited.color.gain,1.8);
});
test('starting look resolves provenance and retains an imported baseline across edits',()=>{
 const storage=memory(),factory=FACTORY_LOOKS[2];
 assert.deepEqual(startingLook({id:'a',origin:{type:'factory',presetId:factory.id}},[],storage).color,factory.look.color);
 assert.deepEqual(startingLook({id:'b',origin:{type:'blank'}},[],storage),NEUTRAL_LOOK);
 const imported={id:'c',origin:{type:'import'},look:structuredClone(NEUTRAL_LOOK)};imported.look.color.gain=1.3;
 startingLook(imported,[],storage,'user');imported.look.color.gain=1.8;
 assert.equal(startingLook(imported,[],storage,'user').color.gain,1.3);
 assert.equal(startingLook(imported,[],storage,'other-user').color.gain,1.8);
 assert.deepEqual(readGroupState(storage),{});
});
