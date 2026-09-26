import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRenderScale, readOutputSettings, saveOutputSetting, RENDER_SCALE_KEY } from '../src/output-settings.js';
import { command } from '../src/engine/protocol.js';
test('output settings default, clamp and persist on renderer storage',()=>{
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 assert.deepEqual(readOutputSettings(storage),{quality:'high',renderScale:.78});
 for(const [value,expected] of [[null,.78],['bad',.78],[.1,.5],[2,1],[.65,.65]])assert.equal(normalizeRenderScale(value),expected);
 saveOutputSetting(storage,RENDER_SCALE_KEY,.65);
 saveOutputSetting(storage,'eyes4beat_bloom_quality','low');
 assert.deepEqual(readOutputSettings(storage),{quality:'low',renderScale:.65});
 assert.deepEqual(readOutputSettings({getItem(){throw Error()}}),{quality:'high',renderScale:.78});
});
test('resolution command accepts only finite scale in supported range',()=>{
 for(const value of [.5,.78,1])assert.equal(command(1,'setRenderScale',{value}).payload.value,value);
 for(const value of [.49,1.01,NaN,Infinity,'0.8'])assert.throws(()=>command(1,'setRenderScale',{value}));
});
