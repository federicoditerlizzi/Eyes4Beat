import test from 'node:test';
import assert from 'node:assert/strict';
import {FLOW_DEFAULTS,flowVector,flowDisplacement,advectFeedbackUV,effectiveFlowStrength} from '../src/flow-field.js';
import {normalizeLook,FACTORY_LOOKS} from '../src/looks.js';
import {blendPost} from '../src/post-effects.js';
import {blankMap,routeTargets} from '../src/config.js';
import {computeTargetState,NEUTRAL_TARGETS} from '../src/routing.js';
import {prepareImportedArchetype} from '../src/library/package-mapping.js';
import {lookFieldRelevant} from '../src/ui/control-relevance.js';
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
test('animated fBm curl has near-zero divergence in UV coordinates at different aspects and octaves',()=>{
 const h=1e-5;
 for(const aspect of [.7,1,16/9])for(const octaves of [1,2,3,4])for(const [u,v] of [[.17,.23],[.52,.6],[.91,.14]]){
  const settings={...FLOW_DEFAULTS,scale:2.3,octaves};
  const f=uv=>flowVector(uv,1.7,settings,aspect);
  const divergence=(f([u+h,v])[0]-f([u-h,v])[0]+f([u,v+h])[1]-f([u,v-h])[1])/(2*h);
  near(divergence,0,5e-5);
 }
});
test('curl field is continuous at noise grid boundaries and across time',()=>{
 const settings={...FLOW_DEFAULTS,speed:0,octaves:4,scale:2};
 for(const edge of [0,.5,1]){
  const left=flowVector([edge-1e-8,.37],0,settings),right=flowVector([edge+1e-8,.37],0,settings);
  left.forEach((v,i)=>near(v,right[i],1e-5));
 }
 const a=flowVector([.31,.72],2,FLOW_DEFAULTS,16/9),b=flowVector([.31,.72],2+1e-8,FLOW_DEFAULTS,16/9);
 a.forEach((v,i)=>near(v,b[i],1e-5));
});
test('flow displacement scales linearly with dt: a fixed field has the same one-second displacement at 30/60/120 FPS',()=>{
 const vector=flowVector([.3,.7],1,{...FLOW_DEFAULTS,scale:2},16/9);
 assert.ok(Math.hypot(...vector)>0);
 const expected=flowDisplacement(vector,.004,1);
 for(const fps of [30,60,120]){
  const total=[0,0];for(let i=0;i<fps;i++)flowDisplacement(vector,.004,1/fps).forEach((v,k)=>total[k]+=v);
  total.forEach((v,k)=>near(v,expected[k]));
 }
 const uv=[.3,.7],settings={...FLOW_DEFAULTS,strength:.004};
 advectFeedbackUV(uv,1,settings,1/60,16/9).forEach((v,i)=>near(v,uv[i]-flowVector(uv,1,settings,16/9)[i]*.004));
 assert.deepEqual(flowDisplacement(vector,0,1),[0,0].map((_,i)=>-vector[i]*0));
});
test('image flow is perpendicular to a synthetic luminance gradient and follows contour direction',()=>{
 for(const aspect of [1,16/9]){
  const gradient=[.3,.7],luminance=([u,v])=>gradient[0]*u*aspect+gradient[1]*v;
  const vector=flowVector([.5,.5],1,{...FLOW_DEFAULTS,source:'image'},aspect,luminance);
  const physical=[vector[0]*aspect,vector[1]];
  near(physical[0]*gradient[0]+physical[1]*gradient[1],0);
  assert.ok(physical[0]>0&&physical[1]<0);
 }
 assert.deepEqual(flowVector([.5,.5],0,{...FLOW_DEFAULTS,source:'image'},1,()=>.5),[0,-0]);
});
test('flow look defaults off, clamps and rounds octaves, preserving old looks/packages',()=>{
 const look=normalizeLook({feedback:{flow:{strength:1,scale:50,speed:-1,octaves:2.7,source:'image'}}});
 assert.deepEqual(look.feedback.flow,{strength:.01,scale:8,speed:0,octaves:3,source:'image'});
 const low=normalizeLook({feedback:{flow:{strength:-1,scale:0,speed:5,octaves:0,source:'invalid'}}});
 assert.deepEqual(low.feedback.flow,{strength:0,scale:.5,speed:2,octaves:1,source:'noise'});
 for(const version of [1,2,3])assert.deepEqual(prepareImportedArchetype({name:'Old',media:[],look:{feedback:{amount:.9}}},version).look.feedback.flow,FLOW_DEFAULTS);
 for(const factory of FACTORY_LOOKS)assert.deepEqual(factory.look.feedback.flow,FLOW_DEFAULTS);
});
test('flow routing adds a bounded share to base, neutral and PANIC stay off',()=>{
 assert.equal(effectiveFlowStrength(FLOW_DEFAULTS),0);
 near(effectiveFlowStrength({...FLOW_DEFAULTS,strength:.004},.5),.007);
 assert.equal(effectiveFlowStrength({...FLOW_DEFAULTS,strength:.004},2),.01);
 assert.equal(effectiveFlowStrength({...FLOW_DEFAULTS,strength:.004},1,false),0);
 assert.equal(NEUTRAL_TARGETS.flow,0);
 const map=blankMap();map.level.flow=1;const values=Object.fromEntries(routeTargets.map(t=>[t,1]));
 const args={map,sources:{level:1},activeSources:{level:true},intensity:values,reactivity:values,globalReactivity:1};
 assert.equal(computeTargetState(args).flow,1);
 assert.equal(computeTargetState({...args,activeTargets:{flow:false}}).flow,0);
});
test('flow settings blend continuously while octave counts and source stay discrete; editor relevance',()=>{
 const a=normalizeLook({feedback:{amount:.9,flow:{strength:.002,scale:1,octaves:1}}}),b=normalizeLook({feedback:{amount:.9,flow:{strength:.008,scale:3,octaves:4,source:'image'}}});
 const p=blendPost(a,b,.25);near(p.feedback.flow.strength,.0035);near(p.feedback.flow.scale,1.5);assert.equal(p.feedback.flow.octaves,1);
 assert.equal(blendPost(a,b,.75).feedback.flow.octaves,4);
 assert.equal(lookFieldRelevant(normalizeLook(),'feedback.flow.strength'),false);
 assert.equal(lookFieldRelevant(a,'feedback.flow.strength'),true);
 assert.equal(lookFieldRelevant(b,'feedback.flow.octaves'),false);
});
test('one-second animated trajectories stay subpixel-close across 30/60/120 FPS at the ink preset',()=>{
 const trajectories=[30,60,120].map(fps=>{let uv=[.3,.7];for(let i=0;i<fps;i++)uv=advectFeedbackUV(uv,i/fps,{...FLOW_DEFAULTS,strength:.004},1/fps,16/9);return uv});
 for(const uv of trajectories)uv.forEach((v,i)=>near(v,trajectories[2][i],.0003));
});
