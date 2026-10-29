import test from 'node:test';
import assert from 'node:assert/strict';
import { kaleidoUV, feedbackDecay, blendPost } from '../src/post-effects.js';
import { normalizeLook, NEUTRAL_LOOK, FACTORY_LOOKS } from '../src/looks.js';
import { prepareImportedArchetype } from '../src/library/package-mapping.js';
import { computeTargetState, NEUTRAL_TARGETS } from '../src/routing.js';
import { blankMap } from '../src/config.js';
import { lookFieldRelevant } from '../src/ui/control-relevance.js';
import { readOutputSettings, FEEDBACK_KEY } from '../src/output-settings.js';
import { command } from '../src/engine/protocol.js';
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
test('mirrored folding is continuous on every wedge edge and midpoint',()=>{
 for(const segments of [2,3,6,15,16]){
  const k={segments,centerX:.3,centerY:.6,mirror:true},aspect=16/9,rotation=.32;
  for(let edge=0;edge<segments*2;edge++){
   const angle=edge*Math.PI/segments+rotation;
   const uv=a=>[k.centerX+.2*Math.cos(a)/aspect,k.centerY+.2*Math.sin(a)];
   const a=kaleidoUV(uv(angle-1e-9),k,rotation,aspect),b=kaleidoUV(uv(angle+1e-9),k,rotation,aspect);
   a.forEach((v,i)=>near(v,b[i]));
  }
 }
});
test('folding honors center, mirror, off, aspect and rotation',()=>{
 const k={segments:6,centerX:.2,centerY:.7,mirror:true};
 assert.deepEqual(kaleidoUV([.2,.7],k),[.2,.7]);
 assert.deepEqual(kaleidoUV([.1,.9],{segments:0}),[.1,.9]);
 const angle=.8,uv=[.2+.1*Math.cos(angle),.7+.1*Math.sin(angle)];
 const mirrored=kaleidoUV(uv,k),repeat=kaleidoUV(uv,{...k,mirror:false});
 near(mirrored[1],.7+.1*Math.sin(Math.PI/3-angle));near(repeat[1],uv[1]);
 assert.notDeepEqual(mirrored,repeat);
 const rotated=kaleidoUV([.2,.8],k,Math.PI/2);near(rotated[0],.2);near(rotated[1],.8);
});
test('feedback retains the same energy per second at 30, 60 and 120 FPS',()=>{
 for(const amount of [.2,.9,.98])for(const fps of [30,60,120]){
  let energy=1;for(let frame=0;frame<fps;frame++)energy*=feedbackDecay(amount,1/fps);
  near(energy,Math.pow(amount,60),1e-12);
 }
 assert.equal(feedbackDecay(0,1/60),0);
});
test('old and imported looks default off; factories retain exact normalized settings',()=>{
 const old=structuredClone(NEUTRAL_LOOK);delete old.feedback;delete old.kaleido;
 for(const look of [normalizeLook(),normalizeLook(old),...[1,2,3].map(version=>prepareImportedArchetype({name:'Old',media:[],look:old},version).look)]){
  assert.deepEqual(look.feedback,NEUTRAL_LOOK.feedback);assert.deepEqual(look.kaleido,NEUTRAL_LOOK.kaleido);
 }
 for(const factory of FACTORY_LOOKS)assert.deepEqual(normalizeLook(factory.look),factory.look);
});
test('post look settings clamp, segments stay discrete, invalid enums fall back',()=>{
 const look=normalizeLook({kaleido:{segments:1,rotationSpeed:999,centerX:-1,centerY:2,mirror:false},feedback:{amount:1,zoom:-1,rotate:999,driftX:1,driftY:-1,hueShift:1,blend:'bad'}});
 assert.deepEqual(look.kaleido,{segments:2,rotationSpeed:360,centerX:0,centerY:1,mirror:false});
 assert.deepEqual(look.feedback,{amount:.98,zoom:-.05,rotate:180,driftX:.05,driftY:-.05,hueShift:.1,blend:'max'});
 assert.equal(normalizeLook({kaleido:{segments:9.4}}).kaleido.segments,9);
 const a=normalizeLook({kaleido:{segments:6},feedback:{amount:.5}}),b=normalizeLook({kaleido:{segments:8},feedback:{amount:.9,blend:'mix'}});
 const post=blendPost(a,b,.25);assert.equal(post.kaleido.segments,6);near(post.feedback.amount,.6);
});
test('post controls obey relevance and device feedback is independent of bloom quality',()=>{
 assert.equal(lookFieldRelevant(NEUTRAL_LOOK,'kaleido.rotationSpeed'),false);
 assert.equal(lookFieldRelevant(NEUTRAL_LOOK,'feedback.zoom'),false);
 assert.equal(lookFieldRelevant(NEUTRAL_LOOK,'feedback.amount'),true);
 const storage={getItem:key=>key===FEEDBACK_KEY?'false':key==='eyes4beat_bloom_quality'?'off':null};
 assert.equal(readOutputSettings(storage).feedback,false);
 assert.equal(readOutputSettings({getItem:key=>key==='eyes4beat_bloom_quality'?'off':null}).feedback,true);
 assert.equal(command(1,'setFeedback',{value:false}).payload.value,false);
 assert.throws(()=>command(1,'setFeedback',{value:'false'}));
});
test('trails and kaleido route and gate like other targets',()=>{
 const map=blankMap();map.kick.trails=1;map.kick.kaleido=1;
 const args={map,sources:{kick:1},activeSources:{kick:true},intensity:{trails:1,kaleido:1},reactivity:{trails:1,kaleido:1},globalReactivity:1};
 const routed=computeTargetState(args);assert.equal(routed.trails,1);assert.equal(routed.kaleido,1);
 const muted=computeTargetState({...args,activeTargets:{trails:false,kaleido:false}});assert.equal(muted.trails,0);assert.equal(muted.kaleido,0);
 assert.equal(NEUTRAL_TARGETS.trails,0);assert.equal(NEUTRAL_TARGETS.kaleido,0);
});
