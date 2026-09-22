import test from 'node:test';
import assert from 'node:assert/strict';
import { FACTORY_LOOKS, NEUTRAL_LOOK, lookForArchetype, lookUniforms, normalizeLook, stepParticle } from '../src/looks.js';

const expectedWarp = [
  [.018, .12, .35, .12], [.035, .28, .85, .15], [.028, .16, 0, 0],
  [.045, .34, .72, -.2], [.036, .22, 0, 0], [.034, .27, 0, 0],
];
const expectedGrade = [
  [.96, 0, 0, .025], [1.02, 0, .0204, 0], [1.04, .012, .008, .020],
  [1.02, .020, 0, 0], [1.01, .040, 0, .012], [1.02, .030, 0, .035],
];
const expectedParticle = [
  [.34, 'dots', 'rise'], [.58, 'streaks', 'wave-flow'], [.52, 'rings', 'radial'],
  [.90, 'streaks', 'jitter-flow'], [.70, 'dots', 'radial'], [.62, 'streaks', 'depth-flow'],
];

test('look normalization fills defaults and clamps fields', () => {
  const source = { distortion: { amplitude: 9, mode: 'unknown' }, color: { tint: '#abc' }, particles: { density: -5, style: 'bad' } };
  const look = normalizeLook(source);
  assert.equal(look.distortion.amplitude, .12);
  assert.equal(look.distortion.mode, 'directional');
  assert.equal(look.color.tint, '#ffffff');
  assert.equal(look.particles.density, 0);
  assert.equal(look.particles.style, 'dots');
  assert.equal(source.distortion.amplitude, 9);
  assert.deepEqual(normalizeLook(null), NEUTRAL_LOOK);
});

test('six stable factory presets reproduce shader and particle constants', () => {
  for (const [index, factory] of FACTORY_LOOKS.entries()) {
    const uniforms = lookUniforms(factory.look);
    assert.equal(factory.id, ['deep-drift', 'funk-elastic', 'organic-bloom', 'dense-propulsion', 'heart-pulse', 'cyber-heart'][index]);
    assert.deepEqual(uniforms.warp.slice(0, 2), expectedWarp[index].slice(0, 2));
    for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(uniforms.direction[axis] - expectedWarp[index][axis + 2]) < 1e-12);
    for (let channel = 0; channel < 4; channel++) assert.ok(Math.abs(uniforms.grade[channel] - expectedGrade[index][channel]) < 1e-12);
    assert.deepEqual([factory.look.particles.density, factory.look.particles.style, factory.look.particles.motion], expectedParticle[index]);
    assert.equal(factory.look.particles.color, '#beebff');
  }
  assert.deepEqual(lookUniforms(NEUTRAL_LOOK).grade, [1, 0, 0, 0]);
  assert.deepEqual(lookUniforms(NEUTRAL_LOOK).direction, [0, 0]);
});

test('migration assigns built-in and custom template looks, blank stays neutral', () => {
  for (let index = 0; index < 6; index++) {
    assert.deepEqual(lookForArchetype({ name: FACTORY_LOOKS[index].name }, index), FACTORY_LOOKS[index].look);
    assert.deepEqual(lookForArchetype({ customId: 'uuid', templateIndex: index }, 12), FACTORY_LOOKS[index].look);
  }
  assert.deepEqual(lookForArchetype({ customId: 'uuid', templateIndex: null }, 12), NEUTRAL_LOOK);
});

// Reference copy of the previous per-profile particle movement, used only for parity tests.
function oldParticleStep(p, profile, time, width, height, amount, random) {
  const result = { ...p }, density = expectedParticle[profile][0], speed = .12 + density * .22 + amount * .42;
  if (profile === 1) { result.x += (1.2 * speed) * (1 + result.z); result.y += Math.sin((result.x + result.life) * .01) * .16; }
  else if (profile === 2) { const dx = result.x - width / 2, dy = result.y - height / 2, dl = Math.hypot(dx, dy) || 1; result.x += dx / dl * .16 * speed; result.y += dy / dl * .16 * speed; }
  else if (profile === 3) { result.x += 2.2 * speed; result.y += (random() - .5) * .22 * speed; }
  else if (profile === 4) { const dx = result.x - width / 2, dy = result.y - height / 2, dl = Math.hypot(dx, dy) || 1; result.x += dx / dl * .12 * speed; result.y += dy / dl * .12 * speed; }
  else if (profile === 5) { result.x += (result.z + .35) * 1.5 * speed; result.y += Math.sin(time * .001 + result.life) * .08 * speed; }
  else { result.x += Math.sin(time * .0002 + result.life) * .12 * speed; result.y -= .12 * speed * (.5 + result.z); }
  if (result.x < -10) result.x = width + 10;
  if (result.x > width + 10) result.x = -10;
  if (result.y < -10) result.y = height + 10;
  if (result.y > height + 10) result.y = -10;
  return result;
}

test('particle positions match previous branches across six presets and several seeded steps', () => {
  for (let profile = 0; profile < 6; profile++) {
    let current = { x: 118, y: 284, z: .63, r: 1.2, vx: -.2, vy: .1, life: 42 };
    let previous = { ...current };
    let seedA = 17, seedB = 17;
    const randomA = () => ((seedA = (seedA * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const randomB = () => ((seedB = (seedB * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let step = 0; step < 30; step++) {
      current = stepParticle(current, FACTORY_LOOKS[profile].look, step * 33, 1280, 720, .83, randomA);
      previous = oldParticleStep(previous, profile, step * 33, 1280, 720, .83, randomB);
      assert.deepEqual(current, previous, `profile ${profile}, step ${step}`);
    }
  }
});
