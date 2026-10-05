import test from 'node:test';
import assert from 'node:assert/strict';
import { blankMap, routeTargets } from '../src/config.js';
import { computeTargetState, NEUTRAL_TARGETS, resolveTargetActivity } from '../src/routing.js';

const targetControls = Object.fromEntries(
  routeTargets.map((key) => [key, 1]),
);

function compute(overrides = {}) {
  return computeTargetState({
    map: blankMap(),
    sources: {},
    activeSources: {},
    intensity: targetControls,
    reactivity: targetControls,
    globalReactivity: 1,
    ...overrides,
  });
}

test('returns a fully neutral image with no routed sources', () => {
  assert.deepEqual(compute(), NEUTRAL_TARGETS);
});

test('positive level routing drives zoom above neutral', () => {
  const map = blankMap();
  map.level.zoom = 0.5;
  assert.ok(compute({ map, sources: { level: 0.8 }, activeSources: { level: true } }).zoom > 1);
});

test('disabled sources never affect a target', () => {
  const map = blankMap();
  map.level.dist = 1;
  assert.equal(compute({ map, sources: { level: 1 }, activeSources: { level: false } }).dist, 0);
});

test('target intensity zero disables that target', () => {
  const map = blankMap();
  map.kick.pulse = 1;
  const intensity = { ...targetControls, pulse: 0 };
  assert.equal(compute({ map, sources: { kick: 1 }, activeSources: { kick: true }, intensity }).pulse, 0);
});

test('inactive targets return to their own neutral value without affecting other targets', () => {
  const map = blankMap();
  map.level.pulse = 1;map.level.zoom = 1;
  const state=compute({map,sources:{level:1},activeSources:{level:true},activeTargets:{pulse:false,zoom:true}});
  assert.equal(state.pulse,NEUTRAL_TARGETS.pulse);
  assert.ok(state.zoom>NEUTRAL_TARGETS.zoom);
});

test('target solos isolate selected effects without changing their On settings', () => {
  const enabled={pulse:false,zoom:true};
  const solo={pulse:true,zoom:false};
  const active=resolveTargetActivity({enabled,solo});
  assert.equal(active.pulse,true);
  assert.equal(active.zoom,false);
  assert.deepEqual(enabled,{pulse:false,zoom:true});
  assert.deepEqual(solo,{pulse:true,zoom:false});
  assert.equal(resolveTargetActivity({enabled,solo:{}}).pulse,false);
  assert.equal(resolveTargetActivity({enabled,solo:{}}).zoom,true);
});

test('rotation, spiral and tile shuffle respond independently and return to zero', () => {
  const map=blankMap();map.level.rotate=.5;map.level.spiral=.6;map.level.tiles=.7;
  const live=compute({map,sources:{level:1},activeSources:{level:true}});
  for(const key of ['rotate','spiral','tiles'])assert.ok(live[key]>0);
  const off=compute({map,sources:{level:1},activeSources:{level:false}});
  for(const key of ['rotate','spiral','tiles'])assert.equal(off[key],0);
  const muted=compute({map,sources:{level:1},activeSources:{level:true},activeTargets:{rotate:false,spiral:false,tiles:false}});
  for(const key of ['rotate','spiral','tiles'])assert.equal(muted[key],0);
});

test('legacy maps keep only the strongest assignment per target, including negative weights', async () => {
  const { normalizeRoutingMap } = await import('../src/library/runtime.js');
  const map=blankMap();map.level.zoom=.4;map.low.zoom=-.8;map.kick.zoom=.8;
  const normalized=normalizeRoutingMap(map);
  assert.equal(normalized.low.zoom,-.8);
  assert.equal(normalized.level.zoom,0);
  assert.equal(normalized.kick.zoom,0);
  assert.deepEqual(normalizeRoutingMap(normalized),normalized);
  assert.equal(map.level.zoom,.4);
  assert.equal(compute({map,sources:{level:1,kick:1},activeSources:{level:true,kick:true}}).zoom,1);
});

test('reassigning a target clears its previous source without affecting other targets', async () => {
  const { assignTarget } = await import('../src/routing.js');
  const map=blankMap();map.level.zoom=.5;map.level.pulse=.6;
  assignTarget(map,'zoom','kick',-.7);
  assert.equal(map.level.zoom,0);assert.equal(map.kick.zoom,-.7);assert.equal(map.level.pulse,.6);
  assignTarget(map,'zoom','');
  assert.equal(map.kick.zoom,0);
});

test('factory reset maps have at most one source per target', async () => {
  const { FACTORY_LOOKS } = await import('../src/looks.js');
  const { starterRoutingForOrigin } = await import('../src/library/runtime.js');
  for(const preset of FACTORY_LOOKS){
    const map=starterRoutingForOrigin({type:'factory',presetId:preset.id});
    for(const target of routeTargets)assert.ok(Object.values(map).filter(row=>row[target]!==0).length<=1);
  }
});
