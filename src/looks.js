import { ROTATION_DEFAULTS, PULSE_DEFAULTS, BURST_DEFAULTS } from './motion-effects.js';
import { blankMap, eventSourceIds } from './config.js';
import { BLOOM_DEFAULTS } from './bloom.js';

export const LOOK_STORAGE_KEY = 'arv_v047_looks';

export const LOOK_FIELDS = {
  rotation: { maxAngle: [0, 180, 1], maxSpeed: [0, 360, 1] },
  pulse: { centerX: [0, 1, .01], centerY: [0, 1, .01], strength: [0, 3, .01], speed: [.1, 3, .01], width: [.01, .5, .01], chromatic: [0, 1, .01] },
  'particles.burst': { amount: [0, 200, 1], speed: [0, 1000, 1], spread: [0, 1, .01] },
  bloom: { base: [0, 1, .01], threshold: [0, 1.5, .01], knee: [0, 1, .01], radius: [0, 1, .01], stretch: [0, 1, .01] },
  vignette: { amount: [0, 1, .01], softness: [.01, 1, .01] },
  frame: { overscan: [0, .15, .005] },
  distortion: { amplitude: [0, .12, .001], speed: [0, 2, .01], angle: [-180, 180, .1], directionStrength: [0, 2, .001] },
  color: { gain: [0, 2, .01], tintAmount: [0, .2, .0001] },
  particles: { density: [0, 2, .01], speed: [0, 3, .01], motionFactor: [0, 5, .01], waveAmount: [0, 2, .01], jitterAmount: [0, 2, .01], depthOffset: [0, 2, .01], streakSlant: [-10, 10, .1] },
};

export const NEUTRAL_LOOK = {
  rotation: { ...ROTATION_DEFAULTS },
  pulse: { ...PULSE_DEFAULTS },
  bloom: { ...BLOOM_DEFAULTS },
  vignette: { amount: 0, softness: .75 },
  frame: { fit: 'cover', edge: 'mirror', overscan: 0 },
  distortion: { amplitude: 0, speed: 0, mode: 'directional', angle: 0, directionStrength: 0 },
  color: { gain: 1, tint: '#ffffff', tintAmount: 0 },
  particles: { colorMode: 'fixed', burst: { ...BURST_DEFAULTS }, density: 0, speed: 1, style: 'dots', motion: 'rise', color: '#beebff', motionFactor: .12, waveAmount: 0, jitterAmount: 0, depthOffset: 0, streakSlant: 0 },
};

const subtitle = ['space / contemplation', 'groove / elastic flow', 'growth / breath / living systems', 'pressure / momentum', 'heart / visceral energy', 'living heart / neon anatomy'];
const names = ['DEEP DRIFT', 'FUNK ELASTIC', 'ORGANIC BLOOM', 'DENSE PROPULSION', 'HEART PULSE', 'CYBER HEART'];
const ids = ['deep-drift', 'funk-elastic', 'organic-bloom', 'dense-propulsion', 'heart-pulse', 'cyber-heart'];
const warp = [
  [.018, .12, 'directional', .35, .12], [.035, .28, 'directional', .85, .15],
  [.028, .16, 'radial', 1, 0], [.045, .34, 'directional', .72, -.2],
  [.036, .22, 'radial', 1, 0], [.034, .27, 'radial', 1, 0],
];
const grading = [
  [.96, '#0000ff', .025], [1.02, '#00ff00', .0204], [1.04, '#9966ff', .02],
  [1.02, '#ff0000', .02], [1.01, '#c8003c', .051], [1.02, '#cc00ee', .0375],
];
const particleProfiles = [
  [.34, 'dots', 'rise', .12, 0, 0, 0, 0],
  [.58, 'streaks', 'wave-flow', 1.2, .16, 0, 0, 0],
  [.52, 'rings', 'radial', .16, 0, 0, 0, 0],
  [.90, 'streaks', 'jitter-flow', 2.2, 0, .22, 0, 0],
  [.70, 'dots', 'radial', .12, 0, 0, 0, 0],
  [.62, 'streaks', 'depth-flow', 1.5, .08, 0, .35, 3],
];

export const FACTORY_LOOKS = names.map((name, index) => {
  const [amplitude, speed, mode, x, y] = warp[index];
  const [gain, tint, tintAmount] = grading[index];
  const [density, style, motion, motionFactor, waveAmount, jitterAmount, depthOffset, streakSlant] = particleProfiles[index];
  return { id: ids[index], name, subtitle: subtitle[index], look: {
    rotation: { ...ROTATION_DEFAULTS },
    pulse: { ...PULSE_DEFAULTS },
    bloom: { ...BLOOM_DEFAULTS, threshold: [.85,.7,.65,.9,.75,.8][index], radius: [.85,.45,.8,.35,.6,.7][index],
      tint: ['#dce8ff','#fff0d8','#e8dcff','#ffe8e0','#ffd8e4','#e0d8ff'][index], stretch: [0,.15,0,.45,0,.65][index] },
    vignette: { amount: .18, softness: .75 },
    frame: { ...NEUTRAL_LOOK.frame },
    distortion: { amplitude, speed, mode, angle: mode === 'directional' ? Math.atan2(y, x) * 180 / Math.PI : 0,
      directionStrength: mode === 'directional' ? Math.hypot(x, y) : 1 },
    color: { gain, tint, tintAmount },
    particles: { colorMode: 'fixed', burst: { ...BURST_DEFAULTS }, density, speed: 1, style, motion, color: '#beebff', motionFactor, waveAmount, jitterAmount, depthOffset, streakSlant },
  } };
});

function starterMap(entries) {
  const map = blankMap();
  for (const [source, target, weight] of entries) map[source][target] = weight;
  map.energy.rotate = .45; map.drive.spiral = .55; map.kick.tiles = .7;
  return map;
}
const starterRoutes = [
  [['energy','luma',.55],['bright','glow',.70],['open','luma',.38],['open','glow',.28],['open','zoom',-.25],['tension','dist',.38],['density','parts',.42],['kick','pulse',.28],['snare','glow',.34]],
  [['energy','pulse',.72],['energy','zoom',.18],['drive','pulse',.42],['boombap','luma',.38],['boombap','sat',.20],['density','parts',.55],['tension','dist',.42],['kick','pulse',.55],['snare','glow',.46]],
  [['energy','sat',.35],['energy','luma',.18],['bright','glow',.55],['bright','luma',.28],['open','glow',.42],['open','zoom',-.38],['density','parts',.45],['kick','pulse',.20],['snare','glow',.24]],
  [['energy','dist',.58],['energy','pulse',.48],['energy','zoom',.28],['boombap','dist',.38],['boombap','zoom',.15],['tension','dist',.68],['density','parts',.78],['drive','parts',.32],['kick','pulse',.68],['snare','luma',.55],['snare','glow',.48]],
  [['energy','luma',.48],['energy','sat',.42],['energy','pulse',.35],['boombap','zoom',.14],['tension','dist',.45],['bright','glow',.55],['density','parts',.48],['kick','pulse',.88],['snare','glow',.58],['snare','luma',.40]],
  [['energy','pulse',.72],['energy','glow',.44],['energy','luma',.28],['density','parts',.36],['boombap','sat',.32],['boombap','zoom',.18],['tension','dist',.40],['bright','glow',.62],['open','zoom',-.12],['kick','pulse',1.10],['snare','glow',.52]],
];
FACTORY_LOOKS.forEach((preset, index) => {
  preset.starter = { routingMap: starterMap(starterRoutes[index]), imageSource: ['open','drive','bright','energy','boombap','boombap'][index] };
});

const clampNumber = (value, fallback, limits) => Number.isFinite(Number(value)) && value !== null && value !== ''
  ? Math.min(limits[1], Math.max(limits[0], Number(value))) : fallback;
const colorValue = (value, fallback) => /^#[a-f\d]{6}$/i.test(value || '') ? value.toLowerCase() : fallback;

export function normalizeLook(source) {
  const output = structuredClone(NEUTRAL_LOOK);
  // Missing vignette on a stored/imported look preserves the former fixed amount.
  // New Blank looks carry an explicit zero; no source means a new neutral look.
  if (source && !source.vignette) output.vignette.amount = .18;
  for (const group of Object.keys(LOOK_FIELDS)) {
    for (const [key, limits] of Object.entries(LOOK_FIELDS[group])) {
      const path = group.split('.'), target = path.reduce((value, part) => value[part], output);
      const value = path.reduce((value, part) => value?.[part], source);
      target[key] = clampNumber(value?.[key], target[key], limits);
    }
  }
  output.rotation.mode = ['angle', 'spin'].includes(source?.rotation?.mode) ? source.rotation.mode : output.rotation.mode;
  output.rotation.direction = ['cw', 'ccw', 'flip-on-beat'].includes(source?.rotation?.direction) ? source.rotation.direction : output.rotation.direction;
  output.rotation.returnToRest = typeof source?.rotation?.returnToRest === 'boolean' ? source.rotation.returnToRest : output.rotation.returnToRest;
  output.pulse.mode = ['breath', 'shockwave'].includes(source?.pulse?.mode) ? source.pulse.mode : output.pulse.mode;
  output.particles.colorMode = source?.particles?.colorMode === 'palette' ? 'palette' : 'fixed';
  output.particles.burst.trigger = eventSourceIds().includes(source?.particles?.burst?.trigger) ? source.particles.burst.trigger : 'none';
  output.particles.burst.origin = source?.particles?.burst?.origin === 'random' ? 'random' : 'center';
  output.frame.fit = ['cover', 'contain', 'stretch'].includes(source?.frame?.fit) ? source.frame.fit : output.frame.fit;
  output.frame.edge = ['mirror', 'clamp'].includes(source?.frame?.edge) ? source.frame.edge : output.frame.edge;
  output.distortion.mode = ['directional', 'radial'].includes(source?.distortion?.mode) ? source.distortion.mode : output.distortion.mode;
  output.bloom.tint = colorValue(source?.bloom?.tint, output.bloom.tint);
  output.color.tint = colorValue(source?.color?.tint, output.color.tint);
  output.particles.color = colorValue(source?.particles?.color, output.particles.color);
  output.particles.style = ['dots', 'rings', 'streaks'].includes(source?.particles?.style) ? source.particles.style : output.particles.style;
  output.particles.motion = ['rise', 'wave-flow', 'radial', 'jitter-flow', 'depth-flow'].includes(source?.particles?.motion) ? source.particles.motion : output.particles.motion;
  return output;
}

export function lookForProfile(index) { return normalizeLook(FACTORY_LOOKS[index]?.look || NEUTRAL_LOOK); }

export function lookForArchetype(archetype, index) {
  if (archetype?.customId && archetype.templateIndex == null) return normalizeLook(NEUTRAL_LOOK);
  return lookForProfile(archetype?.templateIndex ?? index);
}

export function hexRgb(hex) { return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)); }

export function lookUniforms(look) {
  const { distortion, color, frame = NEUTRAL_LOOK.frame, vignette = { amount: .18, softness: .75 } } = look;
  const angle = distortion.angle * Math.PI / 180;
  const direction = distortion.mode === 'radial' ? [0, 0] :
    [Math.cos(angle) * distortion.directionStrength, Math.sin(angle) * distortion.directionStrength];
  const offset = hexRgb(color.tint).map(value => value / 255 * color.tintAmount);
  return { warp: [distortion.amplitude, distortion.speed, distortion.mode === 'radial' ? 1 : 0, distortion.directionStrength],
    frame: [['cover', 'contain', 'stretch'].indexOf(frame.fit), frame.edge === 'mirror' ? 0 : 1, frame.overscan],
    vignette: [vignette.amount, vignette.softness],
    direction, grade: [color.gain, ...offset] };
}

export function particleSpeed(look, amount) {
  return (.12 + look.particles.density * .22 + amount * .42) * look.particles.speed;
}

export function stepParticle(p, look, time, width, height, amount, random = Math.random) {
  const result = { ...p }, settings = look.particles, speed = particleSpeed(look, amount);
  if (settings.motion === 'wave-flow') {
    result.x += settings.motionFactor * speed * (1 + result.z);
    result.y += Math.sin((result.x + result.life) * .01) * settings.waveAmount;
  } else if (settings.motion === 'radial') {
    const dx = result.x - width / 2, dy = result.y - height / 2, length = Math.hypot(dx, dy) || 1;
    result.x += dx / length * settings.motionFactor * speed;
    result.y += dy / length * settings.motionFactor * speed;
  } else if (settings.motion === 'jitter-flow') {
    result.x += settings.motionFactor * speed;
    result.y += (random() - .5) * settings.jitterAmount * speed;
  } else if (settings.motion === 'depth-flow') {
    result.x += (result.z + settings.depthOffset) * settings.motionFactor * speed;
    result.y += Math.sin(time * .001 + result.life) * settings.waveAmount * speed;
  } else {
    result.x += Math.sin(time * .0002 + result.life) * settings.motionFactor * speed;
    result.y -= settings.motionFactor * speed * (.5 + result.z);
  }
  if (result.x < -10) result.x = width + 10;
  if (result.x > width + 10) result.x = -10;
  if (result.y < -10) result.y = height + 10;
  if (result.y > height + 10) result.y = -10;
  return result;
}
