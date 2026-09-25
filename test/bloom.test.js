import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOOM_DEFAULTS, blendBloom, bloomMipSizes, softThreshold, normalizeBloomQuality } from '../src/bloom.js';
import { FACTORY_LOOKS, NEUTRAL_LOOK, normalizeLook } from '../src/looks.js';
import { prepareImportedArchetype } from '../src/library/package-mapping.js';

test('soft threshold is zero below its knee, continuous, monotonic, including hard knee', () => {
  for (const threshold of [0,.75,1.5]) for (const knee of [0,.1,.5,1]) {
    let previous=0;
    for(let i=0;i<=4000;i++) {
      const x=i/1000, value=softThreshold(x,threshold,knee);
      if(x<=threshold-knee) assert.equal(value,0);
      assert.ok(value>=previous && value<=x+1e-12);previous=value;
    }
    for(const boundary of [threshold-knee,threshold+knee]) {
      assert.ok(Math.abs(softThreshold(boundary+1e-7,threshold,knee)-softThreshold(boundary-1e-7,threshold,knee))<3e-7);
    }
  }
});
test('mip sizes cover high/low, odd dimensions and tiny surfaces without zero-sized targets', () => {
  assert.deepEqual(bloomMipSizes(1920,1080),[[960,540],[480,270],[240,135],[120,67],[60,33],[30,16]]);
  assert.deepEqual(bloomMipSizes(1920,1080,'low'),[[480,270],[240,135],[120,67]]);
  assert.deepEqual(bloomMipSizes(1365,767),[[682,383],[341,191],[170,95],[85,47],[42,23],[21,11]]);
  assert.deepEqual(bloomMipSizes(1,1),[[1,1]]);
  assert.deepEqual(bloomMipSizes(3,17),[[1,8],[1,4],[1,2],[1,1]]);
  assert.deepEqual(bloomMipSizes(1920,1080,'off'),[]);
  assert.equal(normalizeBloomQuality('bogus'),'high');
});
test('bloom defaults migrate older looks and all package versions; fields clamp', () => {
  for(const look of [null,{},NEUTRAL_LOOK,{color:{gain:1}}]) assert.deepEqual(normalizeLook(look).bloom,BLOOM_DEFAULTS);
  assert.deepEqual(normalizeLook({bloom:{base:9,threshold:9,knee:-1,radius:9,stretch:-1,tint:'bad'}}).bloom,
    {base:1,threshold:1.5,knee:0,radius:1,stretch:0,tint:'#ffffff'});
  assert.deepEqual(normalizeLook({bloom:{base:NaN,threshold:Infinity,tint:'#12AB34'}}).bloom,{...BLOOM_DEFAULTS,tint:'#12ab34'});
  for(const version of [1,2,3]) assert.deepEqual(prepareImportedArchetype({name:'Old',media:[],look:{}},version).look.bloom,BLOOM_DEFAULTS);
  const bloom={...BLOOM_DEFAULTS,base:.3,tint:'#ff0000',stretch:.7};
  assert.deepEqual(prepareImportedArchetype({name:'New',media:[],look:{bloom}},3).look.bloom,bloom);
  for(const factory of FACTORY_LOOKS) {assert.equal(factory.look.bloom.base,0);assert.deepEqual(normalizeLook(factory.look).bloom,factory.look.bloom);}
});
test('glow routing adds to base, blends looks and stays neutral at zero', () => {
  assert.equal(blendBloom().intensity,0);
  const a={...BLOOM_DEFAULTS,base:.2,tint:'#ff0000'},b={...BLOOM_DEFAULTS,base:.6,tint:'#0000ff'};
  assert.equal(blendBloom(a,b,.5,.5).intensity,.9);
  assert.deepEqual(blendBloom(a,b,.5).tint,[.5,0,.5]);
});
