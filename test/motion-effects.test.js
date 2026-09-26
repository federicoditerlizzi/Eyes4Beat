import test from 'node:test';
import assert from 'node:assert/strict';
import { createRotationState, stepRotation, rotationCover, rotationCoverAt, rotationActivityAt, ROTATION_DEFAULTS, createWaveState, stepWaves, waveUniforms, breathPhase } from '../src/motion-effects.js';
import { NEUTRAL_LOOK, normalizeLook, FACTORY_LOOKS } from '../src/looks.js';
import { sourceRegistry, eventSourceIds } from '../src/config.js';
import { prepareImportedArchetype } from '../src/library/package-mapping.js';
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const spin={...ROTATION_DEFAULTS,mode:'spin',maxSpeed:90};
test('spin integrates velocity, wraps and is independent of step count',()=>{
 const a=createRotationState(),b=createRotationState();
 for(let i=0;i<100;i++)stepRotation(a,spin,1.5,.05,i*.05);
 for(let i=0;i<500;i++)stepRotation(b,spin,1.5,.01,i*.01);
 near(a.angle,90);near(a.angle,b.angle);
 stepRotation(a,{...spin,direction:'ccw'},1.5,1,6);near(a.angle,0);
});
test('directions and flip-on-beat use event counts, angle mode maps range',()=>{
 const state=createRotationState(),settings={...spin,direction:'flip-on-beat'};
 stepRotation(state,settings,1.5,1,1);near(state.angle,90);
 stepRotation(state,settings,1.5,1,2,1);near(state.angle,0);
 stepRotation(state,settings,1.5,1,3,2);near(state.angle,-90);
 stepRotation(state,{...ROTATION_DEFAULTS,maxAngle:60,direction:'ccw'},.75,.1,4);near(state.angle,-30);
});
test('spin waits one second then returns by shortest path over two seconds, PANIC is immediate',()=>{
 const state=createRotationState();stepRotation(state,spin,1.5,1,1);
 stepRotation(state,spin,0,0,2);stepRotation(state,spin,0,.5,2.5);near(state.angle,90);
 stepRotation(state,spin,0,.5,4);near(state.angle,45);
 stepRotation(state,spin,0,.5,5);near(state.angle,0);assert.equal(state.active,false);
 stepRotation(state,spin,1.5,1,6);stepRotation(state,{...spin,returnToRest:false},0,10,16);near(state.angle,90);
 stepRotation(state,spin,1.5,.1,17,0,true);assert.deepEqual(state,createRotationState());
});
test('cover scale is fixed per mode and aspect, never instantaneous drive/angle',()=>{
 const state=createRotationState(),aspect=16/9;
 for(const mode of ['angle','spin']){
  const settings={...spin,mode,fill:1},cover=rotationCover(settings,aspect);
  for(const drive of [.1,.5,1,1.5]){stepRotation(state,settings,drive,.1,1);assert.equal(rotationCover(settings,aspect),cover);}
 }
 near(rotationCover({...spin,fill:1},aspect),(1+aspect)/Math.sqrt(2));
 near(rotationCover({...ROTATION_DEFAULTS,maxAngle:0},aspect),1);
 near(rotationCover({...ROTATION_DEFAULTS,fill:1},aspect),Math.hypot(1,aspect));
});
test('shockwave edges, hysteresis, peak strength and refractory interval do not retrigger held input',()=>{
 const s=createWaveState();stepWaves(s,.1,0);assert.equal(s.waves.length,0);
 stepWaves(s,.3,.01);stepWaves(s,.9,.02);stepWaves(s,.1,.2);stepWaves(s,.9,.3);
 assert.equal(s.waves.length,1);near(s.waves[0].strength,.9);
 stepWaves(s,0,.31);stepWaves(s,.5,.32);assert.equal(s.waves.length,2);
 stepWaves(s,0,.33);stepWaves(s,.7,.34);stepWaves(s,.7,.6);assert.equal(s.waves.length,2);
 stepWaves(s,0,.61);stepWaves(s,.7,.62);assert.equal(s.waves.length,3);
});
test('four concurrent waves replace oldest, expire and reset with PANIC',()=>{
 const s=createWaveState();
 for(let i=0;i<6;i++){stepWaves(s,0,i*.2);stepWaves(s,1,i*.2+.01);}
 assert.equal(s.waves.length,4);assert.equal(s.waves[0].id,3);
 assert.equal(waveUniforms(s.waves).length,8);
 stepWaves(s,0,8);assert.equal(s.waves.length,0);
 stepWaves(s,1,9);stepWaves(s,1,9.1,{panic:true});assert.equal(s.waves.length,0);assert.equal(s.armed,true);
});
test('breath phase follows tempo and has continuous free-running fallback',()=>{
 near(breathPhase(100,120,.25,.125),Math.PI);near(breathPhase(100,0),600);
});
test('new look fields default and clamp; legacy packages keep compatible modes',()=>{
 for(const version of [1,2,3]){
  const look=prepareImportedArchetype({name:'Old',media:[],look:{}},version).look;
  assert.deepEqual(look.rotation,NEUTRAL_LOOK.rotation);assert.deepEqual(look.pulse,NEUTRAL_LOOK.pulse);
  assert.deepEqual(look.particles.burst,NEUTRAL_LOOK.particles.burst);assert.equal(look.particles.colorMode,'fixed');
 }
 for(const factory of FACTORY_LOOKS)assert.deepEqual(normalizeLook(factory.look),factory.look);
 const look=normalizeLook({rotation:{mode:'spin',maxAngle:900,maxSpeed:-1,direction:'bad',returnToRest:false},pulse:{mode:'shockwave',centerX:-1,centerY:2,width:0,chromatic:10},particles:{colorMode:'palette',burst:{amount:999,speed:-1,spread:3,trigger:'bad',origin:'random'}}});
 assert.equal(look.rotation.maxAngle,180);assert.equal(look.rotation.maxSpeed,0);assert.equal(look.rotation.returnToRest,false);
 assert.equal(look.pulse.centerX,0);assert.equal(look.pulse.centerY,1);assert.equal(look.pulse.width,.01);assert.equal(look.pulse.chromatic,1);
 assert.deepEqual(look.particles.burst,{trigger:'none',amount:200,speed:0,spread:1,origin:'random'});
 assert.deepEqual(prepareImportedArchetype({name:'New',media:[],look},3).look,look);
});
test('event trigger options and normalization derive from registry including future sources',()=>{
 sourceRegistry.push({id:'midi-pad-1',kind:'event'});
 try{assert.ok(eventSourceIds().includes('midi-pad-1'));assert.equal(normalizeLook({particles:{burst:{trigger:'midi-pad-1'}}}).particles.burst.trigger,'midi-pad-1');}
 finally{sourceRegistry.pop();}
});

test('rotation fill defaults to zero, interpolates cover and migrates partial looks',()=>{
 for(const mode of ['angle','spin']) for(const aspect of [16/9,4/3,1,9/16]) {
  const settings={...ROTATION_DEFAULTS,mode};
  const full=rotationCover({...settings,fill:1},aspect);
  near(rotationCover(settings,aspect),1);
  near(rotationCover({...settings,fill:.5},aspect),(1+full)/2);
 }
 assert.equal(normalizeLook({rotation:{mode:'spin'}}).rotation.fill,0);
 assert.equal(normalizeLook({rotation:{fill:-1}}).rotation.fill,0);
 assert.equal(normalizeLook({rotation:{fill:2}}).rotation.fill,1);
});

test('rotation cover eases over half a second without jumps, including reversals',()=>{
 const state=createRotationState(),settings={...ROTATION_DEFAULTS,fill:1,returnToRest:false},aspect=16/9;
 stepRotation(state,settings,1,.01,1);
 near(rotationCoverAt(state,settings,aspect,1),1);
 near(rotationActivityAt(state,1.25),.5);
 near(rotationActivityAt(state,1.5),1);
 const before=rotationCoverAt(state,settings,aspect,1.2);
 stepRotation(state,settings,0,.01,1.2);
 near(rotationCoverAt(state,settings,aspect,1.2),before);
 const reverse=rotationCoverAt(state,settings,aspect,1.3);
 stepRotation(state,settings,1,.01,1.3);
 near(rotationCoverAt(state,settings,aspect,1.3),reverse);
 near(rotationActivityAt(state,1.8),1);
 stepRotation(state,settings,0,.01,2);
 near(rotationActivityAt(state,2),1);
 near(rotationActivityAt(state,2.25),.5);
 near(rotationCoverAt(state,settings,aspect,2.5),1);
 stepRotation(state,settings,1,.01,3);
 stepRotation(state,settings,1,.01,3.3,0,true);
 near(rotationCoverAt(state,settings,aspect,3.3),1);
});
