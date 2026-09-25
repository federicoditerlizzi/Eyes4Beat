import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightShoulder, toneColor, outputColor, vignetteFactor, TONE_KNEE } from '../src/tone.js';
import { NEUTRAL_LOOK, FACTORY_LOOKS, normalizeLook, lookUniforms } from '../src/looks.js';
import { NEUTRAL_TARGETS } from '../src/routing.js';
import { prepareImportedArchetype } from '../src/library/package-mapping.js';

const close = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a-b) <= tolerance, `${a} != ${b}`);
test('highlight shoulder is identity below knee, bounded, monotonic and slope-continuous', () => {
  for (let i=0;i<=800;i++) assert.equal(highlightShoulder(i/1000),i/1000);
  let previous=0;
  for(let i=0;i<=40000;i++) {
    const value=highlightShoulder(i/1000);
    assert.ok(value>=previous && value<=1);
    previous=value;
  }
  const h=1e-6;
  close((highlightShoulder(TONE_KNEE)-highlightShoulder(TONE_KNEE-h))/h,1,1e-5);
  close((highlightShoulder(TONE_KNEE+h)-highlightShoulder(TONE_KNEE))/h,1,1e-5);
  close(highlightShoulder(1),.9264241117657115);
});
test('maximum-channel shoulder preserves saturated RGB ratios', () => {
  const color=[2,.4,.02], result=toneColor(color);
  assert.ok(result[0]<1 && result[0]>.99);
  close(result[1]/result[0],color[1]/color[0]);
  close(result[2]/result[0],color[2]/color[0]);
  assert.deepEqual(toneColor([0,0,0]),[0,0,0]);
});
test('neutral grade, vignette and tone preserve a color sweep across the screen', () => {
  for(const resolution of [[1920,1080],[1080,1920],[1000,1000]]) {
    for(const uv of [[0,0],[1,1],[.5,.5],[.1,.7]]) {
      for(let i=0;i<=800;i++) {
        const v=i/1000;
        for(const color of [[v,v,v],[v,v*.37,v*.01],[v*.1,v*.2,v]]) {
          const result=outputColor(color,{look:NEUTRAL_LOOK,targets:NEUTRAL_TARGETS,uv,resolution});
          result.forEach((value,j)=>close(value,color[j],1/255));
        }
      }
    }
  }
  const result=outputColor([1,.5,.1],{targets:{...NEUTRAL_TARGETS,luma:3,glow:2}});
  assert.ok(result.every(value=>Number.isFinite(value)&&value>=0&&value<=1));
});
test('vignette is circular in pixel space and amount zero bypasses it', () => {
  const settings={amount:.18,softness:.75},resolution=[1600,900];
  close(vignetteFactor([.5+300/1600,.5],resolution,settings),vignetteFactor([.5,.5+300/900],resolution,settings));
  close(vignetteFactor([.5,.5],resolution,settings),1);
  close(vignetteFactor([0,0],resolution,{...settings,amount:0}),1);
  close(vignetteFactor([0,0],resolution,settings),.82);
});
test('vignette migration preserves old looks while new Blank stays neutral', () => {
  assert.deepEqual(normalizeLook(null).vignette,{amount:0,softness:.75});
  assert.deepEqual(normalizeLook(NEUTRAL_LOOK).vignette,{amount:0,softness:.75});
  assert.deepEqual(normalizeLook({color:{gain:1}}).vignette,{amount:.18,softness:.75});
  for(const factory of FACTORY_LOOKS) assert.deepEqual(factory.look.vignette,{amount:.18,softness:.75});
  assert.deepEqual(normalizeLook({vignette:{amount:4,softness:-1}}).vignette,{amount:1,softness:.01});
  assert.deepEqual(normalizeLook({vignette:{amount:-1,softness:4}}).vignette,{amount:0,softness:1});
  assert.deepEqual(normalizeLook({vignette:{amount:NaN,softness:Infinity}}).vignette,{amount:0,softness:.75});
  for(const version of [1,2,3]) {
    const imported=prepareImportedArchetype({name:'Old',media:[],look:{color:{gain:1}}},version);
    assert.deepEqual(imported.look.vignette,{amount:.18,softness:.75});
  }
  const imported=prepareImportedArchetype({name:'Blank',media:[],look:NEUTRAL_LOOK},3);
  assert.deepEqual(lookUniforms(imported.look).vignette,[0,.75]);
});
