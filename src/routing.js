import { routeSources, routeTargets } from './config.js';

const UNIPOLAR_TARGETS = new Set(['pulse', 'dist', 'glow', 'parts', 'rotate', 'spiral', 'tiles']);

export const NEUTRAL_TARGETS = Object.freeze({
  pulse: 0,
  dist: 0,
  glow: 0,
  luma: 1,
  sat: 1,
  parts: 0,
  zoom: 1,
  rotate: 0,
  spiral: 0,
  tiles: 0,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const shape = (value) => Math.sign(value) * Math.sqrt(Math.abs(value));

// Legacy maps resolve deterministically: strongest absolute weight, source order on ties.
export function assignedSource(map, target) {
  let selected = null, strongest = 0;
  for (const source of routeSources) {
    const weight = Number(map?.[source]?.[target]);
    if (Number.isFinite(weight) && Math.abs(weight) > strongest) {
      selected = source;
      strongest = Math.abs(weight);
    }
  }
  return selected;
}

export function assignTarget(map, target, source, weight = 1) {
  const value = Number(weight);
  for (const key of routeSources) {
    map[key] ??= {};
    map[key][target] = key === source && Number.isFinite(value) ? clamp(value, -1.5, 1.5) : 0;
  }
  return map;
}

export function resolveTargetActivity({ enabled, solo }) {
  const anySolo = routeTargets.some(target => !!solo[target]);
  return Object.fromEntries(routeTargets.map(target => [target, anySolo ? !!solo[target] : enabled[target] !== false]));
}

export function computeTargetState({
  map,
  sources,
  activeSources,
  activeTargets,
  intensity,
  reactivity,
  globalReactivity,
}) {
  const modulation = {};

  for (const target of routeTargets) {
    const unipolar = UNIPOLAR_TARGETS.has(target);
    let sum = 0;

    const source = assignedSource(map, target);
    if (source && activeSources[source]) {
      const weight = map[source]?.[target] ?? 0;
      const value = clamp(sources[source] ?? 0, 0, 1.5);
      sum += unipolar && weight < 0
        ? Math.abs(weight) * (1 - clamp(value, 0, 1))
        : weight * value;
    }

    modulation[target] = shape(sum * globalReactivity);
  }

  const driven = (target) => activeTargets?.[target] === false ? 0 : intensity[target] * reactivity[target];
  return {
    pulse: clamp(driven('pulse') * Math.max(0, modulation.pulse), 0, 1.5),
    dist: clamp(driven('dist') * Math.max(0, modulation.dist), 0, 1.5),
    glow: clamp(driven('glow') * Math.max(0, modulation.glow), 0, 1.8),
    parts: clamp(driven('parts') * Math.max(0, modulation.parts), 0, 1.8),
    luma: clamp(1 + driven('luma') * modulation.luma * 0.60, 0.4, 1.8),
    sat: clamp(1 + driven('sat') * modulation.sat * 0.75, 0, 1.8),
    zoom: clamp(1 + driven('zoom') * modulation.zoom * 0.20, 0.78, 1.28),
    rotate: clamp(driven('rotate') * Math.max(0, modulation.rotate), 0, 1.5),
    spiral: clamp(driven('spiral') * Math.max(0, modulation.spiral), 0, 1.5),
    tiles: clamp(driven('tiles') * Math.max(0, modulation.tiles), 0, 1.5),
  };
}
