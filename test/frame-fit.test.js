import test from 'node:test';
import assert from 'node:assert/strict';
import { frameFit, frameUv } from '../src/frame-fit.js';
import { FACTORY_LOOKS, normalizeLook, lookUniforms } from '../src/looks.js';
import { prepareImportedArchetype } from '../src/library/package-mapping.js';

const close = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12, `${actual} != ${expected}`));
test('centered cover, contain and stretch on wide and standard screens', () => {
  for (const [image, screen, cover, contain] of [
    [3/2, 16/9, [1,27/32], [32/27,1]],
    [3/2, 4/3, [8/9,1], [1,9/8]],
    [1, 16/9, [1,9/16], [16/9,1]],
    [1, 4/3, [1,3/4], [4/3,1]],
    [2/3, 16/9, [1,3/8], [8/3,1]],
    [2/3, 4/3, [1,1/2], [2,1]],
  ]) {
    for (const [fit, expected] of [['cover',cover],['contain',contain],['stretch',[1,1]]]) {
      const result = frameFit(image, screen, fit);
      close(result.scale, expected);
      close(result.offset, expected.map(value => (1-value)/2));
      close(frameUv([.5,.5], image, screen, {fit}), [.5,.5]);
    }
  }
});
test('overscan zooms around center; mirror handles negative and repeated edges; contain stays background', () => {
  close(frameFit(1,1,'cover',.15).scale, [1/1.15,1/1.15]);
  close(frameUv([-.2,2.3],1,1), [.2,.3]);
  close(frameUv([-.2,2.3],1,1,{edge:'clamp'}), [0,1]);
  for (const edge of ['mirror','clamp']) assert.equal(frameUv([0,.5],3/2,16/9,{fit:'contain',edge}), null);
  close(frameFit(0,NaN,'stretch',Infinity).scale,[1,1]);
});
test('old looks and package versions default framing; new settings clamp and survive import', () => {
  const defaults = {fit:'cover',edge:'mirror',overscan:0};
  assert.deepEqual(normalizeLook({}).frame, defaults);
  for (const preset of FACTORY_LOOKS) assert.deepEqual(preset.look.frame, defaults);
  assert.deepEqual(normalizeLook({frame:{fit:'bad',edge:'bad',overscan:2}}).frame, {...defaults,overscan:.15});
  assert.equal(normalizeLook({frame:{overscan:-1}}).frame.overscan,0);
  assert.equal(normalizeLook({frame:{overscan:NaN}}).frame.overscan,0);
  for (const version of [1,2,3]) assert.deepEqual(prepareImportedArchetype({name:'Old',media:[],look:{}},version).look.frame, defaults);
  const frame = {fit:'contain',edge:'clamp',overscan:.1};
  const imported = prepareImportedArchetype({name:'New',media:[],look:{frame}},3).look;
  assert.deepEqual(imported.frame,frame);
  assert.deepEqual(lookUniforms(imported).frame,[1,1,.1]);
});
