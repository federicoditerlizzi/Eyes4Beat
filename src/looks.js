import { blankMap } from './config.js';

export const LOOK_STORAGE_KEY = 'arv_v047_looks';

export const LOOK_FIELDS = {
  distortion: { amplitude: [0, .12, .001], speed: [0, 2, .01], angle: [-180, 180, .1], directionStrength: [0, 2, .001] },
  color: { gain: [0, 2, .01], tintAmount: [0, .2, .0001] },
  particles: { density: [0, 2, .01], speed: [0, 3, .01], motionFactor: [0, 5, .01], waveAmount: [0, 2, .01], jitterAmount: [0, 2, .01], depthOffset: [0, 2, .01], streakSlant: [-10, 10, .1] },
};

export const NEUTRAL_LOOK = {
  distortion: { amplitude: 0, speed: 0, mode: 'directional', angle: 0, directionStrength: 0 },
  color: { gain: 1, tint: '#ffffff', tintAmount: 0 },
  particles: { density: 0, speed: 1, style: 'dots', motion: 'rise', color: '#beebff', motionFactor: .12, waveAmount: 0, jitterAmount: 0, depthOffset: 0, streakSlant: 0 },
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
    distortion: { amplitude, speed, mode, angle: mode === 'directional' ? Math.atan2(y, x) * 180 / Math.PI : 0,
      directionStrength: mode === 'directional' ? Math.hypot(x, y) : 1 },
    color: { gain, tint, tintAmount },
    particles: { density, speed: 1, style, motion, color: '#beebff', motionFactor, waveAmount, jitterAmount, depthOffset, streakSlant },
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
  for (const group of Object.keys(LOOK_FIELDS)) {
    for (const [key, limits] of Object.entries(LOOK_FIELDS[group])) {
      output[group][key] = clampNumber(source?.[group]?.[key], output[group][key], limits);
    }
  }
  output.distortion.mode = ['directional', 'radial'].includes(source?.distortion?.mode) ? source.distortion.mode : output.distortion.mode;
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
  const { distortion, color } = look;
  const angle = distortion.angle * Math.PI / 180;
  const direction = distortion.mode === 'radial' ? [0, 0] :
    [Math.cos(angle) * distortion.directionStrength, Math.sin(angle) * distortion.directionStrength];
  const offset = hexRgb(color.tint).map(value => value / 255 * color.tintAmount);
  return { warp: [distortion.amplitude, distortion.speed, distortion.mode === 'radial' ? 1 : 0, distortion.directionStrength],
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
